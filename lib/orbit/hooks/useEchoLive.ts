import { useState, useRef, useCallback, useEffect } from 'react';
import { GoogleGenAI, Modality, LiveServerMessage, MediaResolution } from '@google/genai';
import { STATUS_MESSAGES, sanitizeErrorMessage, logInfo, logError } from '../config/serviceAliases';

interface UseEchoLiveOptions {
  apiKey: string;
  onTranscript?: (text: string, isFinal: boolean) => void;
  onAudioChunk?: (data: Uint8Array) => void;
  systemPrompt?: string;
  voiceName?: string;
  targetLanguage?: string;
}

interface UseEchoLiveReturn {
  isConnected: boolean;
  isListening: boolean;
  isSpeaking: boolean;
  error: string | null;
  status: string;
  connect: () => Promise<void>;
  disconnect: () => void;
  sendAudio: (base64Audio: string) => void;
  sendText: (text: string) => void;
  startMicrophone: () => Promise<void>;
  stopMicrophone: () => void;
}

/**
 * Simplified Echo Live Hook
 *
 * Uses Gemini Live API for real-time STT + TTS in one session.
 * - Speak → See transcription in real-time
 * - Listen → Hear translated audio + see text
 *
 * No separate APIs for transcription, translation, or TTS.
 * Everything handled through one WebSocket connection.
 */
export function useEchoLive(options: UseEchoLiveOptions): UseEchoLiveReturn {
  const {
    apiKey,
    onTranscript,
    onAudioChunk,
    systemPrompt,
    voiceName = 'Orus',
    targetLanguage = 'English',
  } = options;

  const [isConnected, setIsConnected] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string>('Disconnected');

  const clientRef = useRef<GoogleGenAI | null>(null);
  const sessionRef = useRef<any>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const audioQueueRef = useRef<Uint8Array[]>([]);
  const isPlayingRef = useRef(false);

  /**
   * Decode base64 PCM audio to Uint8Array
   */
  const decodeAudio = useCallback((base64: string): Uint8Array => {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
  }, []);

  /**
   * Decode PCM16 to AudioBuffer for playback
   */
  const decodePCMToAudioBuffer = useCallback(async (pcmData: Uint8Array): Promise<AudioBuffer> => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({
        sampleRate: 24000,
      });
    }

    const ctx = audioContextRef.current;

    // Convert Uint8Array to Int16Array (PCM16)
    const int16Data = new Int16Array(pcmData.buffer);

    // Create AudioBuffer
    const audioBuffer = ctx.createBuffer(1, int16Data.length, 24000);
    const channelData = audioBuffer.getChannelData(0);

    // Normalize PCM16 to Float32 [-1, 1]
    for (let i = 0; i < int16Data.length; i++) {
      channelData[i] = int16Data[i] / 32768;
    }

    return audioBuffer;
  }, []);

  /**
   * Play audio queue sequentially
   */
  const playAudioQueue = useCallback(async () => {
    if (isPlayingRef.current) return;
    isPlayingRef.current = true;
    setIsSpeaking(true);

    const ctx = audioContextRef.current;
    if (!ctx) {
      isPlayingRef.current = false;
      setIsSpeaking(false);
      return;
    }

    while (audioQueueRef.current.length > 0) {
      const chunk = audioQueueRef.current.shift();
      if (!chunk) continue;

      try {
        // Decode PCM to AudioBuffer
        const audioBuffer = await decodePCMToAudioBuffer(chunk);

        // Play
        const source = ctx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(ctx.destination);

        await new Promise<void>((resolve) => {
          source.onended = () => resolve();
          source.start();
        });
      } catch (e) {
        logError('ECHO', e);
      }
    }

    isPlayingRef.current = false;
    setIsSpeaking(false);
  }, [decodePCMToAudioBuffer]);

  /**
   * Connect to Echo Live session
   */
  const connect = useCallback(async () => {
    try {
      setStatus(STATUS_MESSAGES.INITIALIZING);
      setError(null);

      // Initialize audio context
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({
          sampleRate: 24000,
        });
      }

      // Initialize client
      clientRef.current = new GoogleGenAI({ apiKey });

      // Default system prompt for translation
      const defaultPrompt = `You are Echo, a real-time translation assistant.
      When you receive speech, respond with:
      1. A transcription in the original language
      2. A translation to ${targetLanguage}
      
      Format your response as:
      [ORIGINAL]: <transcribed text>
      [${targetLanguage.toUpperCase()}]: <translated text>
      
      Speak the translation naturally as if a native speaker.`;

      // Connect to Live API
      const sessionPromise = clientRef.current.live.connect({
        model: 'models/gemini-2.5-flash-native-audio-preview-12-2025',
        config: {
          responseModalities: [Modality.AUDIO],
          mediaResolution: MediaResolution.MEDIA_RESOLUTION_MEDIUM,
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName },
            },
          },
          contextWindowCompression: {
            triggerTokens: '104857',
            slidingWindow: { targetTokens: '52428' },
          },
          systemInstruction: systemPrompt || defaultPrompt,
        },
        callbacks: {
          onopen: () => {
            logInfo('ECHO', STATUS_MESSAGES.CONNECTION_READY);
            setStatus(STATUS_MESSAGES.CONNECTION_READY);
            setIsConnected(true);
          },
          onmessage: async (message: LiveServerMessage) => {
            // Handle audio output
            if (message.serverContent?.modelTurn?.parts) {
              for (const part of message.serverContent.modelTurn.parts) {
                if (part.inlineData?.data) {
                  const pcmData = decodeAudio(part.inlineData.data);
                  audioQueueRef.current.push(pcmData);
                  onAudioChunk?.(pcmData);
                  playAudioQueue();
                }
                if (part.text) {
                  onTranscript?.(part.text, false);
                }
              }
            }

            // Handle transcription
            if (message.serverContent?.outputTranscription) {
              const text = message.serverContent.outputTranscription.text;
              if (text) {
                onTranscript?.(text, true);
              }
            }

            // Turn complete - flush audio queue
            if (message.serverContent?.turnComplete) {
              if (audioQueueRef.current.length > 0) {
                playAudioQueue();
              }
            }
          },
          onclose: () => {
            setStatus('Disconnected');
            setIsConnected(false);
            setIsListening(false);
            logInfo('ECHO', 'Session closed');
          },
          onerror: (e) => {
            const sanitized = sanitizeErrorMessage(e);
            setError(sanitized);
            setStatus(STATUS_MESSAGES.ERROR);
            logError('ECHO', sanitized);
          },
        },
      });

      sessionRef.current = await sessionPromise;
    } catch (e) {
      const sanitized = sanitizeErrorMessage(e);
      setError(sanitized);
      setStatus(STATUS_MESSAGES.ERROR);
      logError('ECHO', sanitized);
    }
  }, [
    apiKey,
    voiceName,
    systemPrompt,
    targetLanguage,
    onTranscript,
    onAudioChunk,
    decodeAudio,
    playAudioQueue,
  ]);

  /**
   * Disconnect from session
   */
  const disconnect = useCallback(() => {
    stopMicrophone();

    if (sessionRef.current) {
      try {
        sessionRef.current.close();
      } catch (e) {
        // Ignore close errors
      }
      sessionRef.current = null;
    }

    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }

    clientRef.current = null;
    setIsConnected(false);
    setIsListening(false);
    setStatus('Disconnected');
  }, []);

  /**
   * Send audio to session
   */
  const sendAudio = useCallback(
    (base64Audio: string) => {
      if (!sessionRef.current || !isConnected) return;

      sessionRef.current.sendRealtimeInput({
        audio: {
          mimeType: 'audio/pcm;rate=16000',
          data: base64Audio,
        },
      });
    },
    [isConnected],
  );

  /**
   * Send text to session
   */
  const sendText = useCallback(
    (text: string) => {
      if (!sessionRef.current || !isConnected) return;

      sessionRef.current.sendClientContent({
        turns: [{ parts: [{ text }] }],
        turnComplete: true,
      });
    },
    [isConnected],
  );

  /**
   * Start microphone capture
   */
  const startMicrophone = useCallback(async () => {
    try {
      setStatus(STATUS_MESSAGES.LISTENING);
      setIsListening(true);

      // Get microphone stream
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 16000,
        },
      });
      mediaStreamRef.current = stream;

      // Create audio context for input
      const inputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({
        sampleRate: 16000,
      });

      const source = inputCtx.createMediaStreamSource(stream);
      const processor = inputCtx.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;

      processor.onaudioprocess = (e) => {
        if (!isConnected || !sessionRef.current) return;

        const inputData = e.inputBuffer.getChannelData(0);

        // Convert Float32 to Int16 PCM
        const pcm16 = new Int16Array(inputData.length);
        for (let i = 0; i < inputData.length; i++) {
          pcm16[i] = Math.max(-1, Math.min(1, inputData[i])) * 0x7fff;
        }

        // Base64 encode
        const base64 = btoa(String.fromCharCode(...new Uint8Array(pcm16.buffer)));

        // Send to session
        sendAudio(base64);
      };

      source.connect(processor);
      processor.connect(inputCtx.destination);

      logInfo('ECHO', 'Microphone started');
    } catch (e) {
      const sanitized = sanitizeErrorMessage(e);
      setError(sanitized);
      logError('ECHO', sanitized);
      setIsListening(false);
    }
  }, [isConnected, sendAudio]);

  /**
   * Stop microphone capture
   */
  const stopMicrophone = useCallback(() => {
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }

    setIsListening(false);
    setStatus(isConnected ? STATUS_MESSAGES.CONNECTION_READY : 'Disconnected');
    logInfo('ECHO', 'Microphone stopped');
  }, [isConnected]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  return {
    isConnected,
    isListening,
    isSpeaking,
    error,
    status,
    connect,
    disconnect,
    sendAudio,
    sendText,
    startMicrophone,
    stopMicrophone,
  };
}

export default useEchoLive;
