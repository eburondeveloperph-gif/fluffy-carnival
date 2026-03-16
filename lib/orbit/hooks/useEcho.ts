import { useState, useRef, useCallback, useEffect } from 'react';
import { GoogleGenAI, Modality, LiveServerMessage } from '@google/genai';
import {
  SERVICE_ALIASES,
  STATUS_MESSAGES,
  sanitizeErrorMessage,
  logInfo,
  logError,
} from '../config/serviceAliases';

// Single model for everything: STT + Translation + TTS
const ECHO_MODEL = 'models/gemini-2.5-flash-native-audio-preview-12-2025';

interface UseEchoOptions {
  apiKey?: string;
  targetLanguage?: string;
  onTranscript?: (text: string) => void;
  onError?: (error: string) => void;
}

interface UseEchoReturn {
  isConnected: boolean;
  isListening: boolean;
  isSpeaking: boolean;
  status: string;
  error: string | null;
  transcript: string;
  connect: () => Promise<void>;
  disconnect: () => void;
  sendAudio: (pcmBase64: string) => void;
  sendText: (text: string) => void;
}

/**
 * useEcho - Simplified Real-Time Speech Translation
 *
 * Single model handles everything:
 * - Speech-to-Text (transcription)
 * - Translation (to target language)
 * - Text-to-Speech (speaks translation)
 *
 * No separate APIs needed!
 */
export function useEcho(options: UseEchoOptions = {}): UseEchoReturn {
  const {
    apiKey = process.env.NEXT_PUBLIC_GEMINI_API_KEY || '',
    targetLanguage = 'Spanish',
    onTranscript,
    onError,
  } = options;

  const [isConnected, setIsConnected] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [status, setStatus] = useState('Disconnected');
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState('');

  const clientRef = useRef<GoogleGenAI | null>(null);
  const sessionRef = useRef<any>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const audioQueueRef = useRef<Uint8Array[]>([]);
  const isPlayingRef = useRef(false);

  /**
   * Decode base64 to Uint8Array
   */
  const decodeBase64 = useCallback((base64: string): Uint8Array => {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }, []);

  /**
   * Play audio queue
   */
  const playAudioQueue = useCallback(async () => {
    if (isPlayingRef.current || audioQueueRef.current.length === 0) return;

    isPlayingRef.current = true;
    setIsSpeaking(true);

    const ctx = audioCtxRef.current;
    if (!ctx) {
      isPlayingRef.current = false;
      setIsSpeaking(false);
      return;
    }

    while (audioQueueRef.current.length > 0) {
      const chunk = audioQueueRef.current.shift();
      if (!chunk) continue;

      try {
        // PCM16 to Float32
        const int16 = new Int16Array(chunk.buffer);
        const audioBuffer = ctx.createBuffer(1, int16.length, 24000);
        const channelData = audioBuffer.getChannelData(0);
        for (let i = 0; i < int16.length; i++) {
          channelData[i] = int16[i] / 32768;
        }

        // Play
        const source = ctx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(ctx.destination);

        await new Promise<void>((resolve) => {
          source.onended = () => resolve();
          source.start();
        });
      } catch (e) {
        // Ignore playback errors
      }
    }

    isPlayingRef.current = false;
    setIsSpeaking(false);
  }, []);

  /**
   * Connect to Echo
   */
  const connect = useCallback(async () => {
    try {
      setStatus('Connecting...');
      setError(null);

      // Audio context for playback
      audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({
        sampleRate: 24000,
      });

      // Initialize client
      clientRef.current = new GoogleGenAI({ apiKey });

      // System prompt for translation
      const systemPrompt = `You are a real-time speech translator.
      
When you hear speech:
1. Transcribe it accurately
2. Translate to ${targetLanguage}
3. Speak the translation naturally

Format your response:
[ORIGINAL]: <transcribed text>
[${targetLanguage.toUpperCase()}]: <translated text>

Speak ONLY the translation, not the original text.`;

      // Connect to Live API
      const sessionPromise = clientRef.current.live.connect({
        model: ECHO_MODEL,
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: 'Orus' },
            },
          },
          systemInstruction: systemPrompt,
        },
        callbacks: {
          onopen: () => {
            logInfo('ECHO', 'Connected');
            setStatus(STATUS_MESSAGES.CONNECTION_READY);
            setIsConnected(true);
          },
          onmessage: async (msg: LiveServerMessage) => {
            // Handle transcription
            if (msg.serverContent?.outputTranscription) {
              const text = msg.serverContent.outputTranscription.text;
              if (text) {
                setTranscript(text);
                onTranscript?.(text);
              }
            }

            // Handle model turn (text + audio)
            if (msg.serverContent?.modelTurn?.parts) {
              for (const part of msg.serverContent.modelTurn.parts) {
                // Text transcription
                if (part.text) {
                  setTranscript(part.text);
                  onTranscript?.(part.text);
                }
                // Audio output
                if (part.inlineData?.data) {
                  const pcmData = decodeBase64(part.inlineData.data);
                  audioQueueRef.current.push(pcmData);
                }
              }
            }

            // Turn complete - start playback
            if (msg.serverContent?.turnComplete) {
              playAudioQueue();
            }
          },
          onclose: () => {
            setStatus('Disconnected');
            setIsConnected(false);
            setIsListening(false);
            logInfo('ECHO', 'Session closed');
          },
          onerror: (e) => {
            const msg = sanitizeErrorMessage(e);
            setError(msg);
            setStatus('Error');
            logError('ECHO', msg);
            onError?.(msg);
          },
        },
      });

      sessionRef.current = await sessionPromise;
    } catch (e) {
      const msg = sanitizeErrorMessage(e);
      setError(msg);
      setStatus('Error');
      logError('ECHO', msg);
      onError?.(msg);
    }
  }, [apiKey, targetLanguage, onTranscript, onError, decodeBase64, playAudioQueue]);

  /**
   * Disconnect
   */
  const disconnect = useCallback(() => {
    sessionRef.current?.close?.();
    sessionRef.current = null;
    audioCtxRef.current?.close?.();
    audioCtxRef.current = null;
    clientRef.current = null;
    audioQueueRef.current = [];
    setIsConnected(false);
    setIsListening(false);
    setIsSpeaking(false);
    setStatus('Disconnected');
  }, []);

  /**
   * Send audio (PCM16 base64)
   */
  const sendAudio = useCallback((pcmBase64: string) => {
    sessionRef.current?.sendRealtimeInput?.({
      audio: { mimeType: 'audio/pcm;rate=16000', data: pcmBase64 },
    });
  }, []);

  /**
   * Send text
   */
  const sendText = useCallback((text: string) => {
    sessionRef.current?.sendClientContent?.({
      turns: [{ parts: [{ text }] }],
      turnComplete: true,
    });
  }, []);

  // Cleanup
  useEffect(
    () => () => {
      disconnect();
    },
    [disconnect],
  );

  return {
    isConnected,
    isListening,
    isSpeaking,
    status,
    error,
    transcript,
    connect,
    disconnect,
    sendAudio,
    sendText,
  };
}

export default useEcho;
