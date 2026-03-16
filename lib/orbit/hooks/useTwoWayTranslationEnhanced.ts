import { useState, useRef, useCallback, useEffect } from 'react';
import { startTranscriptionSession } from '../services/geminiService';
import { AudioSeparationManager, useAudioSeparation } from '../services/AudioSeparationManager';
import { Language } from '../types';

export type UserRole = 'speaker' | 'listener' | 'idle';

export interface TranslationMessage {
  id: string;
  speakerId: string;
  speakerName: string;
  originalText: string;
  timestamp: number;
  targetLanguages: Map<string, string>; // userId -> language name
  translations: Map<string, string>; // language -> translated text
  audioBuffers: Map<string, ArrayBuffer>; // language -> audio buffer
  status: 'transcribing' | 'translating' | 'synthesizing' | 'ready' | 'completed';
}

export interface RemoteUser {
  userId: string;
  userName: string;
  selectedLanguage: Language;
  role: UserRole;
  isConnected: boolean;
}

interface UseTwoWayTranslationEnhancedOptions {
  meetingId: string | null;
  myUserId: string;
  myUserName: string;
  myLanguage: Language;
  webSocketUrl?: string;
  enableDucking?: boolean;
}

interface UseTwoWayTranslationEnhancedReturn {
  // Role & State
  myRole: UserRole;
  setMyRole: (role: UserRole) => Promise<void>;
  isReady: boolean;

  // Remote users
  remoteUsers: RemoteUser[];

  // Messages
  messages: TranslationMessage[];
  currentMessage: TranslationMessage | null;

  // Audio separation
  isAudioSeparated: boolean;
  isDucking: boolean;
  inputLevel: number;
  outputVolume: number;
  setOutputVolume: (volume: number) => void;

  // Processing states
  isTranscribing: boolean;
  isTranslating: boolean;
  isPlaying: boolean;

  // Errors
  error: string | null;

  // Controls
  toggleRole: () => Promise<void>;
  disconnect: () => void;
}

/**
 * ENHANCED Two-Way Real-Time Translation Hook with Robust Audio Separation
 *
 * This version uses AudioSeparationManager for:
 * - Complete isolation between input and output audio
 * - Smart ducking when user speaks
 * - Hardware-level echo cancellation
 * - Bidirectional audio without interference
 */
export function useTwoWayTranslationEnhanced(
  options: UseTwoWayTranslationEnhancedOptions,
): UseTwoWayTranslationEnhancedReturn {
  const {
    meetingId,
    myUserId,
    myUserName,
    myLanguage,
    webSocketUrl,
    enableDucking = true,
  } = options;

  // Use audio separation hook
  const {
    isInitialized: isAudioSeparated,
    isDucking,
    inputLevel,
    volume: outputVolume,
    initialize: initializeAudio,
    getMicrophoneStream,
    playTTSAudio,
    setVolume: setOutputVolume,
    startVAD,
    stopVAD,
  } = useAudioSeparation({
    inputSampleRate: 16000,
    outputSampleRate: 24000,
    enableEchoCancellation: true,
    enableNoiseSuppression: true,
    enableAutoGainControl: true,
    outputVolume: 0.8,
    duckingThreshold: 0.02,
    duckingReduction: 0.2,
  });

  // Role state
  const [myRole, setMyRoleState] = useState<UserRole>('idle');
  const [isReady, setIsReady] = useState(false);

  // Remote users
  const [remoteUsers, setRemoteUsers] = useState<RemoteUser[]>([]);

  // Messages
  const [messages, setMessages] = useState<TranslationMessage[]>([]);
  const [currentMessage, setCurrentMessage] = useState<TranslationMessage | null>(null);

  // Processing states
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isTranslating, setIsTranslating] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Refs
  const inputStreamRef = useRef<MediaStream | null>(null);
  const geminiSessionRef = useRef<any>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const maxReconnectAttempts = 5;
  const audioQueueRef = useRef<Array<{ buffer: ArrayBuffer; language: string }>>([]);
  const isPlayingRef = useRef(false);

  /**
   * Connect WebSocket for real-time communication
   */
  const connectWebSocket = useCallback(() => {
    if (!meetingId) return;

    const wsUrl = webSocketUrl || `wss://${window.location.host}/api/ws/translation`;

    try {
      const ws = new WebSocket(`${wsUrl}?meetingId=${meetingId}&userId=${myUserId}`);

      ws.onopen = () => {
        console.log('[TwoWayTranslation] WebSocket connected');
        setIsReady(true);
        reconnectAttemptsRef.current = 0;

        // Announce presence
        ws.send(
          JSON.stringify({
            type: 'user-joined',
            userId: myUserId,
            userName: myUserName,
            language: myLanguage,
            role: myRole,
          }),
        );
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          handleWebSocketMessage(data);
        } catch (err) {
          console.error('[TwoWayTranslation] WebSocket message parse error:', err);
        }
      };

      ws.onerror = (err) => {
        console.error('[TwoWayTranslation] WebSocket error:', err);
        setError('Connection error');
      };

      ws.onclose = () => {
        console.log('[TwoWayTranslation] WebSocket closed');
        setIsReady(false);

        if (reconnectAttemptsRef.current < maxReconnectAttempts) {
          reconnectAttemptsRef.current++;
          const delay = Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current), 30000);
          setTimeout(connectWebSocket, delay);
        }
      };

      wsRef.current = ws;
    } catch (err) {
      console.error('[TwoWayTranslation] WebSocket connection failed:', err);
      setError('Failed to connect');
    }
  }, [meetingId, myUserId, myUserName, myLanguage, myRole, webSocketUrl]);

  /**
   * Handle incoming WebSocket messages
   */
  const handleWebSocketMessage = useCallback(
    async (data: any) => {
      switch (data.type) {
        case 'user-joined':
        case 'user-updated':
          setRemoteUsers((prev) => {
            const existing = prev.find((u) => u.userId === data.userId);
            if (existing) {
              return prev.map((u) =>
                u.userId === data.userId ? { ...u, ...data, isConnected: true } : u,
              );
            }
            return [
              ...prev,
              {
                userId: data.userId,
                userName: data.userName,
                selectedLanguage: data.language,
                role: data.role,
                isConnected: true,
              },
            ];
          });
          break;

        case 'user-left':
          setRemoteUsers((prev) =>
            prev.map((u) => (u.userId === data.userId ? { ...u, isConnected: false } : u)),
          );
          break;

        case 'transcription':
          if (data.speakerId !== myUserId) {
            await handleIncomingTranscription(data);
          }
          break;

        case 'translation-complete':
          setMessages((prev) =>
            prev.map((m) => (m.id === data.messageId ? { ...m, status: 'completed' } : m)),
          );
          break;

        case 'users-list':
          setRemoteUsers(data.users);
          break;
      }
    },
    [myUserId],
  );

  /**
   * Handle incoming transcription from remote speaker
   */
  const handleIncomingTranscription = useCallback(
    async (data: any) => {
      if (myRole !== 'listener') return;

      const message: TranslationMessage = {
        id: data.messageId,
        speakerId: data.speakerId,
        speakerName: data.speakerName,
        originalText: data.text,
        timestamp: data.timestamp,
        targetLanguages: new Map(data.targetLanguages),
        translations: new Map(),
        audioBuffers: new Map(),
        status: 'translating',
      };

      setCurrentMessage(message);
      setIsTranslating(true);

      try {
        // Translate to my language
        const targetLangName = myLanguage.name;

        const translationRes = await fetch('/api/orbit/translate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: data.text,
            targetLang: targetLangName,
          }),
        });

        if (!translationRes.ok) throw new Error('Translation failed');
        const { translation } = await translationRes.json();

        message.translations.set(targetLangName, translation);
        message.status = 'synthesizing';

        setMessages((prev) => [...prev, { ...message }]);

        // Generate TTS
        const ttsRes = await fetch('/api/orbit/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: translation }),
        });

        if (!ttsRes.ok) throw new Error('TTS failed');
        const audioBuffer = await ttsRes.arrayBuffer();

        message.audioBuffers.set(targetLangName, audioBuffer);
        message.status = 'ready';

        // Queue and play audio
        audioQueueRef.current.push({ buffer: audioBuffer, language: targetLangName });
        await playAudioQueue();

        // Notify server
        wsRef.current?.send(
          JSON.stringify({
            type: 'translation-complete',
            messageId: message.id,
            userId: myUserId,
            language: targetLangName,
            translation: translation,
          }),
        );
      } catch (err) {
        console.error('[TwoWayTranslation] Translation error:', err);
        message.status = 'completed';
      } finally {
        setIsTranslating(false);
      }
    },
    [myRole, myLanguage, playTTSAudio],
  );

  /**
   * Play audio queue using audio separation
   */
  const playAudioQueue = useCallback(async () => {
    if (isPlayingRef.current || audioQueueRef.current.length === 0) return;

    isPlayingRef.current = true;
    setIsPlaying(true);

    while (audioQueueRef.current.length > 0) {
      const item = audioQueueRef.current.shift();
      if (!item) continue;

      await playTTSAudio(item.buffer);
    }

    isPlayingRef.current = false;
    setIsPlaying(false);
  }, [playTTSAudio]);

  /**
   * Start speaking mode with Gemini Live transcription
   */
  const startSpeaking = useCallback(async () => {
    if (!isAudioSeparated) {
      await initializeAudio();
    }

    try {
      setIsTranscribing(true);

      // Get microphone stream
      const stream = await getMicrophoneStream();
      if (!stream) {
        throw new Error('Failed to get microphone');
      }

      inputStreamRef.current = stream;

      // Start VAD for ducking
      if (enableDucking) {
        startVAD();
      }

      // Start Gemini Live transcription
      geminiSessionRef.current = await startTranscriptionSession(
        (text) => {
          if (text.trim() && wsRef.current?.readyState === WebSocket.OPEN) {
            const messageId = `msg-${Date.now()}-${myUserId}`;

            // Build target languages map from listeners
            const targetLanguages = new Map<string, string>();
            remoteUsers
              .filter((u) => u.role === 'listener' && u.isConnected)
              .forEach((u) => {
                targetLanguages.set(u.userId, u.selectedLanguage.name);
              });

            wsRef.current.send(
              JSON.stringify({
                type: 'transcription',
                messageId,
                speakerId: myUserId,
                speakerName: myUserName,
                text,
                timestamp: Date.now(),
                targetLanguages: Array.from(targetLanguages.entries()),
              }),
            );

            const message: TranslationMessage = {
              id: messageId,
              speakerId: myUserId,
              speakerName: myUserName,
              originalText: text,
              timestamp: Date.now(),
              targetLanguages,
              translations: new Map(),
              audioBuffers: new Map(),
              status: 'transcribing',
            };

            setCurrentMessage(message);
          }
        },
        () => {
          setIsTranscribing(false);
        },
        myLanguage.name,
      );

      // Set up audio processing
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)({
        sampleRate: 16000,
      });
      const source = audioCtx.createMediaStreamSource(stream);
      const processor = audioCtx.createScriptProcessor(4096, 1, 1);

      processor.onaudioprocess = (e) => {
        const inputData = e.inputBuffer.getChannelData(0);
        const pcm16 = new Int16Array(inputData.length);
        for (let i = 0; i < inputData.length; i++) {
          pcm16[i] = Math.max(-1, Math.min(1, inputData[i])) * 0x7fff;
        }
        const base64 = btoa(String.fromCharCode(...new Uint8Array(pcm16.buffer)));
        geminiSessionRef.current?.sendAudio(base64);
      };

      source.connect(processor);
      processor.connect(audioCtx.destination);

      setMyRoleState('speaker');

      wsRef.current?.send(
        JSON.stringify({
          type: 'role-change',
          userId: myUserId,
          role: 'speaker',
        }),
      );
    } catch (err) {
      console.error('[TwoWayTranslation] Start speaking error:', err);
      setError('Failed to start speaking mode');
      setIsTranscribing(false);
    }
  }, [
    isAudioSeparated,
    initializeAudio,
    getMicrophoneStream,
    enableDucking,
    startVAD,
    myUserId,
    myUserName,
    myLanguage,
    remoteUsers,
  ]);

  /**
   * Start listening mode
   */
  const startListening = useCallback(async () => {
    // Stop VAD
    stopVAD();

    // Stop microphone
    if (inputStreamRef.current) {
      inputStreamRef.current.getTracks().forEach((t) => t.stop());
      inputStreamRef.current = null;
    }

    // Stop Gemini session
    if (geminiSessionRef.current) {
      geminiSessionRef.current.stop();
      geminiSessionRef.current = null;
    }

    setIsTranscribing(false);
    setMyRoleState('listener');

    wsRef.current?.send(
      JSON.stringify({
        type: 'role-change',
        userId: myUserId,
        role: 'listener',
      }),
    );
  }, [stopVAD, myUserId]);

  /**
   * Set role (speaker/listener/idle)
   */
  const setMyRole = useCallback(
    async (role: UserRole) => {
      if (role === myRole) return;

      switch (role) {
        case 'speaker':
          await startSpeaking();
          break;
        case 'listener':
          await startListening();
          break;
        case 'idle':
          await startListening();
          setMyRoleState('idle');
          break;
      }
    },
    [myRole, startSpeaking, startListening],
  );

  /**
   * Toggle between speaker and listener
   */
  const toggleRole = useCallback(async () => {
    if (myRole === 'speaker') {
      await setMyRole('listener');
    } else {
      await setMyRole('speaker');
    }
  }, [myRole, setMyRole]);

  /**
   * Disconnect and cleanup
   */
  const disconnect = useCallback(() => {
    // Stop VAD
    stopVAD();

    // Stop microphone
    if (inputStreamRef.current) {
      inputStreamRef.current.getTracks().forEach((t) => t.stop());
      inputStreamRef.current = null;
    }

    // Stop Gemini session
    if (geminiSessionRef.current) {
      geminiSessionRef.current.stop();
      geminiSessionRef.current = null;
    }

    // Close WebSocket
    wsRef.current?.close();
    wsRef.current = null;

    // Reset state
    setMyRoleState('idle');
    setIsReady(false);
    setRemoteUsers([]);
    audioQueueRef.current = [];
  }, [stopVAD]);

  /**
   * Initialize on mount
   */
  useEffect(() => {
    if (meetingId) {
      connectWebSocket();
    }

    return () => {
      disconnect();
    };
  }, [meetingId, connectWebSocket, disconnect]);

  return {
    myRole,
    setMyRole,
    isReady,
    remoteUsers,
    messages,
    currentMessage,
    isAudioSeparated,
    isDucking,
    inputLevel,
    outputVolume,
    setOutputVolume,
    isTranscribing,
    isTranslating,
    isPlaying,
    error,
    toggleRole,
    disconnect,
  };
}

export default useTwoWayTranslationEnhanced;
