import { useState, useRef, useCallback, useEffect } from 'react';
import { startTranscriptionSession, streamTranslation } from '../services/geminiService';
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

interface UseTwoWayTranslationOptions {
  meetingId: string | null;
  myUserId: string;
  myUserName: string;
  myLanguage: Language;
  webSocketUrl?: string;
}

interface UseTwoWayTranslationReturn {
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
 * Two-Way Real-Time Translation Hook with Gemini Live
 *
 * Features:
 * - Gemini Live Audio transcription for speaker mode
 * - WebSocket broadcast to all listening users
 * - Per-user language translation (each listener gets their own language)
 * - Per-user TTS synthesis
 * - Robust audio separation to prevent feedback
 * - Bidirectional flow (listeners can become speakers)
 *
 * Audio Separation Strategy:
 * 1. Input AudioContext: Captures microphone, processes STT
 * 2. Output AudioContext: Plays TTS, isolated from input
 * 3. Echo Cancellation: Browser native + manual gain control
 * 4. Ducking: Lower TTS volume when speech detected
 */
export function useTwoWayTranslation(
  options: UseTwoWayTranslationOptions,
): UseTwoWayTranslationReturn {
  const { meetingId, myUserId, myUserName, myLanguage, webSocketUrl } = options;

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
  const [isAudioSeparated, setIsAudioSeparated] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Refs for audio separation
  const inputAudioContextRef = useRef<AudioContext | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const inputStreamRef = useRef<MediaStream | null>(null);
  const geminiSessionRef = useRef<any>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);

  // WebSocket ref
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const maxReconnectAttempts = 5;

  // Audio playback queue
  const audioQueueRef = useRef<Array<{ buffer: ArrayBuffer; language: string }>>([]);
  const isPlayingRef = useRef(false);

  /**
   * Initialize Audio Separation
   * Creates separate AudioContexts for input (microphone) and output (TTS)
   */
  const initializeAudioSeparation = useCallback(async () => {
    try {
      // Input AudioContext for microphone capture
      if (!inputAudioContextRef.current) {
        inputAudioContextRef.current = new (
          window.AudioContext || (window as any).webkitAudioContext
        )({
          sampleRate: 16000, // Optimized for speech
        });
      }

      // Output AudioContext for TTS playback
      if (!outputAudioContextRef.current) {
        outputAudioContextRef.current = new (
          window.AudioContext || (window as any).webkitAudioContext
        )({
          sampleRate: 24000, // Optimized for TTS
        });
      }

      // Resume both contexts
      if (inputAudioContextRef.current.state === 'suspended') {
        await inputAudioContextRef.current.resume();
      }
      if (outputAudioContextRef.current.state === 'suspended') {
        await outputAudioContextRef.current.resume();
      }

      setIsAudioSeparated(true);
      console.log('[TwoWayTranslation] Audio separation initialized');
      return true;
    } catch (err) {
      console.error('[TwoWayTranslation] Audio separation failed:', err);
      setError('Failed to initialize audio separation');
      return false;
    }
  }, []);

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

        // Announce presence to other users
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

        // Attempt reconnection
        if (reconnectAttemptsRef.current < maxReconnectAttempts) {
          reconnectAttemptsRef.current++;
          const delay = Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current), 30000);
          console.log(`[TwoWayTranslation] Reconnecting in ${delay}ms...`);
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
          // Update remote users list
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
          // New transcription from another user
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
          // Initial list of users
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
      if (myRole !== 'listener') return; // Only process when listening

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

        // Queue audio for playback
        audioQueueRef.current.push({ buffer: audioBuffer, language: targetLangName });

        // Notify server that translation is complete
        wsRef.current?.send(
          JSON.stringify({
            type: 'translation-complete',
            messageId: message.id,
            userId: myUserId,
            language: targetLangName,
            translation: translation,
          }),
        );

        // Start playback
        await playAudioQueue();
      } catch (err) {
        console.error('[TwoWayTranslation] Translation error:', err);
        message.status = 'completed';
      } finally {
        setIsTranslating(false);
      }
    },
    [myRole, myLanguage],
  );

  /**
   * Play audio queue with audio separation
   */
  const playAudioQueue = useCallback(async () => {
    if (isPlayingRef.current || audioQueueRef.current.length === 0) return;

    isPlayingRef.current = true;
    setIsPlaying(true);

    const audioCtx = outputAudioContextRef.current;
    if (!audioCtx) {
      isPlayingRef.current = false;
      setIsPlaying(false);
      return;
    }

    while (audioQueueRef.current.length > 0) {
      const item = audioQueueRef.current.shift();
      if (!item) continue;

      try {
        const audioBuffer = await audioCtx.decodeAudioData(item.buffer.slice(0));
        const source = audioCtx.createBufferSource();
        source.buffer = audioBuffer;

        // Add gain node for volume control
        const gainNode = audioCtx.createGain();
        gainNode.gain.value = 0.8; // Slightly reduce TTS volume

        source.connect(gainNode);
        gainNode.connect(audioCtx.destination);

        await new Promise<void>((resolve) => {
          source.onended = () => resolve();
          source.start();
        });
      } catch (err) {
        console.error('[TwoWayTranslation] Audio playback error:', err);
      }
    }

    isPlayingRef.current = false;
    setIsPlaying(false);
  }, []);

  /**
   * Start speaking mode with Gemini Live transcription
   */
  const startSpeaking = useCallback(async () => {
    if (!inputAudioContextRef.current) {
      await initializeAudioSeparation();
    }

    try {
      setIsTranscribing(true);

      // Get microphone stream with echo cancellation
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 16000,
        },
      });

      inputStreamRef.current = stream;

      // Start Gemini Live transcription session
      geminiSessionRef.current = await startTranscriptionSession(
        (text) => {
          // On transcript - send to all listeners
          if (text.trim() && wsRef.current?.readyState === WebSocket.OPEN) {
            const messageId = `msg-${Date.now()}-${myUserId}`;

            // Build target languages map from remote users
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

            // Update local state
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
          // On session end
          setIsTranscribing(false);
        },
        myLanguage.name,
      );

      // Set up audio processing
      const audioCtx = inputAudioContextRef.current;
      if (audioCtx) {
        const source = audioCtx.createMediaStreamSource(stream);
        const processor = audioCtx.createScriptProcessor(4096, 1, 1);

        processor.onaudioprocess = (e) => {
          const inputData = e.inputBuffer.getChannelData(0);

          // Convert to 16-bit PCM
          const pcm16 = new Int16Array(inputData.length);
          for (let i = 0; i < inputData.length; i++) {
            pcm16[i] = Math.max(-1, Math.min(1, inputData[i])) * 0x7fff;
          }

          // Base64 encode
          const base64 = btoa(String.fromCharCode(...new Uint8Array(pcm16.buffer)));

          // Send to Gemini
          geminiSessionRef.current?.sendAudio(base64);
        };

        source.connect(processor);
        processor.connect(audioCtx.destination);
        processorRef.current = processor;
      }

      setMyRoleState('speaker');

      // Announce role change
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
  }, [myUserId, myUserName, myLanguage, remoteUsers, initializeAudioSeparation]);

  /**
   * Start listening mode
   */
  const startListening = useCallback(async () => {
    await initializeAudioSeparation();

    // Stop any input streams
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

    // Announce role change
    wsRef.current?.send(
      JSON.stringify({
        type: 'role-change',
        userId: myUserId,
        role: 'listener',
      }),
    );
  }, [initializeAudioSeparation, myUserId]);

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
          await startListening(); // Stop speaking, stay connected
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
    // Stop streams
    if (inputStreamRef.current) {
      inputStreamRef.current.getTracks().forEach((t) => t.stop());
      inputStreamRef.current = null;
    }

    // Stop Gemini session
    if (geminiSessionRef.current) {
      geminiSessionRef.current.stop();
      geminiSessionRef.current = null;
    }

    // Disconnect processor
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }

    // Close audio contexts
    inputAudioContextRef.current?.close();
    outputAudioContextRef.current?.close();
    inputAudioContextRef.current = null;
    outputAudioContextRef.current = null;

    // Close WebSocket
    wsRef.current?.close();
    wsRef.current = null;

    // Reset state
    setMyRoleState('idle');
    setIsReady(false);
    setIsAudioSeparated(false);
    setRemoteUsers([]);
    audioQueueRef.current = [];
  }, []);

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
    isTranscribing,
    isTranslating,
    isPlaying,
    error,
    toggleRole,
    disconnect,
  };
}

export default useTwoWayTranslation;
