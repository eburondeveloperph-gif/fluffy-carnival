'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import {
  useRoomContext,
  useLocalParticipant,
  useRemoteParticipants,
} from '@livekit/components-react';
import { RoomEvent, DataPacket_Kind, RemoteParticipant, Track } from 'livekit-client';

interface TranslationMessage {
  type: 'orbit_translation';
  text: string;
  sourceLanguage?: string;
  targetLanguage?: string;
  timestamp: number;
}

interface UseOrbitTranslatorOptions {
  targetLanguage: string;
  enabled: boolean;
  isSourceSpeaker: boolean; // True if this user holds the floor for translation
  hearRawAudio?: boolean; // If true, remote raw audio is NOT muted when translation is enabled
}

interface UseOrbitTranslatorReturn {
  // Outbound
  sendTranslation: (text: string) => Promise<void>;

  // Inbound
  incomingTranslations: Array<{ participantId: string; text: string; timestamp: number }>;

  // State
  isProcessing: boolean;
  error: string | null;

  // Audio control
  muteRawAudio: (participantId: string) => void;
  unmuteRawAudio: (participantId: string) => void;
  mutedParticipants: Set<string>;
  analyser: AnalyserNode | null;
}

/**
 * Hook for bidirectional Orbit translation via LiveKit Data Channel.
 *
 * Outbound: Sends translated text to all participants (they synthesize TTS locally).
 * Inbound: Receives translated text from participants and synthesizes TTS locally.
 */
export function useOrbitTranslator(options: UseOrbitTranslatorOptions): UseOrbitTranslatorReturn {
  const room = useRoomContext();
  const { localParticipant } = useLocalParticipant();
  const remoteParticipants = useRemoteParticipants();

  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [incomingTranslations, setIncomingTranslations] = useState<
    Array<{ participantId: string; text: string; timestamp: number }>
  >([]);
  const [mutedParticipants, setMutedParticipants] = useState<Set<string>>(new Set());

  const ttsQueueRef = useRef<Array<{ text: string; participantId: string }>>([]);
  const isSpeakingRef = useRef(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const duckStoreRef = useRef<Map<HTMLMediaElement, number>>(new Map());

  const DUCK_LEVEL = 0.25; // 25% volume during TTS

  // Audio Context and Analyser for visualization
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceNodeRef = useRef<MediaElementAudioSourceNode | null>(null);

  // Initialize audio element for TTS playback and setup analysis
  useEffect(() => {
    if (typeof window !== 'undefined' && !audioRef.current) {
      audioRef.current = new Audio();
      audioRef.current.autoplay = true;

      // Setup Web Audio API for visualization
      try {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioContextClass) {
          const ctx = new AudioContextClass();
          audioContextRef.current = ctx;
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 256;
          analyserRef.current = analyser;

          // Connect audio element to analyser
          // Note: createMediaElementSource requires the audio element to be in the DOM or at least created?
          // It works with new Audio() but we must ensure we don't reconnect if it already exists.
          const source = ctx.createMediaElementSource(audioRef.current);
          sourceNodeRef.current = source;
          source.connect(analyser);
          analyser.connect(ctx.destination);
        }
      } catch (err) {
        console.warn('Failed to setup audio analysis for Orbit visualizer:', err);
      }
    }
    return () => {
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close().catch(() => {});
      }
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, []);

  // Resume AudioContext on user interaction if needed (browser autoplay policy)
  const resumeAudioContext = useCallback(() => {
    if (audioContextRef.current && audioContextRef.current.state === 'suspended') {
      audioContextRef.current.resume().catch(() => {});
    }
  }, []);

  // Mute raw audio from a specific participant
  const muteRawAudio = useCallback(
    (participantId: string) => {
      setMutedParticipants((prev) => {
        if (prev.has(participantId)) return prev;
        const participant = remoteParticipants.find((p) => p.identity === participantId);
        if (participant) {
          const audioTrack = participant.getTrackPublication(Track.Source.Microphone);
          if (audioTrack) {
            audioTrack.setEnabled(false);
          }
        }
        return new Set(prev).add(participantId);
      });
    },
    [remoteParticipants],
  );

  // Unmute raw audio from a specific participant
  const unmuteRawAudio = useCallback(
    (participantId: string) => {
      setMutedParticipants((prev) => {
        if (!prev.has(participantId)) return prev;
        const participant = remoteParticipants.find((p) => p.identity === participantId);
        if (participant) {
          const audioTrack = participant.getTrackPublication(Track.Source.Microphone);
          if (audioTrack) {
            audioTrack.setEnabled(true);
          }
        }
        const next = new Set(prev);
        next.delete(participantId);
        return next;
      });
    },
    [remoteParticipants],
  );

  // Auto-mute all remote participants when translation is enabled (unless hearRawAudio is true)
  useEffect(() => {
    if (!options.enabled) {
      // Restore all muted participants
      mutedParticipants.forEach((id) => {
        const participant = remoteParticipants.find((p) => p.identity === id);
        if (participant) {
          const audioTrack = participant.getTrackPublication(Track.Source.Microphone);
          if (audioTrack) {
            audioTrack.setEnabled(true);
          }
        }
      });
      setMutedParticipants(new Set());
      return;
    }

    if (options.hearRawAudio) {
      // Restore all muted participants if hearRawAudio was just toggled ON
      mutedParticipants.forEach((id) => {
        const participant = remoteParticipants.find((p) => p.identity === id);
        if (participant) {
          const audioTrack = participant.getTrackPublication(Track.Source.Microphone);
          if (audioTrack) {
            audioTrack.setEnabled(true);
          }
        }
      });
      setMutedParticipants(new Set());
      return;
    }

    // Mute all remote participants
    remoteParticipants.forEach((participant) => {
      muteRawAudio(participant.identity);
    });
  }, [options.enabled, options.hearRawAudio, remoteParticipants, muteRawAudio]);

  // Duck all other audio/video elements to 25%
  const duckOtherMedia = useCallback(() => {
    if (typeof document === 'undefined') return;
    const elements = Array.from(document.querySelectorAll('audio, video')) as HTMLMediaElement[];
    elements.forEach((el) => {
      if (el === audioRef.current) return;
      if (!duckStoreRef.current.has(el)) {
        duckStoreRef.current.set(el, el.volume);
      }
      el.volume = Math.min(el.volume, DUCK_LEVEL);
    });
  }, []);

  // Restore all ducked audio/video elements
  const restoreOtherMedia = useCallback(() => {
    duckStoreRef.current.forEach((originalVol, el) => {
      try {
        el.volume = originalVol;
      } catch (_) {}
    });
    duckStoreRef.current.clear();
  }, []);

  // Process TTS queue sequentially with ducking
  const processTTSQueue = useCallback(async () => {
    if (isSpeakingRef.current || ttsQueueRef.current.length === 0) {
      console.log('[Orbit] TTS queue empty or already speaking');
      return;
    }

    isSpeakingRef.current = true;
    resumeAudioContext(); // Ensure AudioContext is running
    const next = ttsQueueRef.current.shift();
    console.log('[Orbit] Processing TTS for:', next?.text?.substring(0, 30));

    if (next && audioRef.current) {
      duckOtherMedia(); // Duck before playing
      try {
        console.log('[Orbit] Fetching TTS audio...');
        const response = await fetch('/api/orbit/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: next.text }),
        });

        if (response.ok) {
          const blob = await response.blob();
          console.log('[Orbit] TTS audio received, size:', blob.size);
          const url = URL.createObjectURL(blob);
          audioRef.current.src = url;

          await new Promise<void>((resolve) => {
            if (!audioRef.current) {
              resolve();
              return;
            }
            audioRef.current.onended = () => {
              console.log('[Orbit] TTS playback ended');
              URL.revokeObjectURL(url);
              resolve();
            };
            audioRef.current.onerror = (e) => {
              console.error('[Orbit] TTS playback error:', e);
              URL.revokeObjectURL(url);
              resolve();
            };
            audioRef.current
              .play()
              .then(() => {
                console.log('[Orbit] TTS playback started');
              })
              .catch((e) => {
                console.error('[Orbit] TTS play() failed:', e);
                resolve();
              });
          });
        } else {
          console.error('[Orbit] TTS response not ok:', response.status);
        }
      } catch (e) {
        console.error('[Orbit] TTS synthesis failed:', e);
      }
      restoreOtherMedia(); // Restore after playing
    }

    isSpeakingRef.current = false;

    // Process next item in queue
    if (ttsQueueRef.current.length > 0) {
      processTTSQueue();
    }
  }, [duckOtherMedia, restoreOtherMedia, resumeAudioContext]);

  // Send translation to all participants via Data Channel (only if source speaker)
  const sendTranslation = useCallback(
    async (text: string) => {
      if (!localParticipant || !text.trim()) {
        console.log('[Orbit] sendTranslation blocked: no localParticipant or empty text');
        return;
      }
      if (!options.isSourceSpeaker) {
        console.log('[Orbit] sendTranslation blocked: not source speaker');
        return;
      }

      console.log('[Orbit] Sending translation for:', text.substring(0, 50));
      setIsProcessing(true);
      setError(null);

      try {
        // Translate the text
        const translateResponse = await fetch('/api/orbit/translate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, targetLang: options.targetLanguage }),
        });

        if (!translateResponse.ok) {
          throw new Error('Translation failed');
        }

        const { translation } = await translateResponse.json();
        console.log('[Orbit] Translated to:', translation?.substring(0, 50));

        // Broadcast via Data Channel
        const message: TranslationMessage = {
          type: 'orbit_translation',
          text: translation,
          targetLanguage: options.targetLanguage,
          timestamp: Date.now(),
        };

        const payload = new TextEncoder().encode(JSON.stringify(message));
        await localParticipant.publishData(payload, { reliable: true });
        console.log('[Orbit] Translation broadcasted to all participants');
      } catch (e: any) {
        setError(e.message || 'Translation failed');
        console.error('[Orbit] Send translation failed:', e);
      } finally {
        setIsProcessing(false);
      }
    },
    [localParticipant, options.targetLanguage, options.isSourceSpeaker],
  );

  // Listen for incoming translations
  useEffect(() => {
    if (!room || !options.enabled) {
      console.log('[Orbit] Data channel listener not active:', {
        room: !!room,
        enabled: options.enabled,
      });
      return;
    }

    console.log('[Orbit] Setting up data channel listener for translations');

    const handleDataReceived = (payload: Uint8Array, participant?: RemoteParticipant) => {
      // Ignore messages from self (shouldn't happen, but safety check)
      if (!participant || participant.identity === localParticipant?.identity) {
        return;
      }

      try {
        const data = JSON.parse(new TextDecoder().decode(payload));
        console.log('[Orbit] Received data:', data.type);

        if (data.type === 'orbit_translation' && data.text) {
          console.log(
            '[Orbit] Received translation from',
            participant.identity,
            ':',
            data.text?.substring(0, 50),
          );

          // Add to incoming translations list
          setIncomingTranslations((prev) => [
            ...prev.slice(-50), // Keep last 50
            {
              participantId: participant.identity,
              text: data.text,
              timestamp: data.timestamp,
            },
          ]);

          // Queue TTS synthesis
          console.log('[Orbit] Queuing TTS for:', data.text?.substring(0, 30));
          ttsQueueRef.current.push({ text: data.text, participantId: participant.identity });
          processTTSQueue();
        }
      } catch (e) {
        // Not a translation message, ignore
      }
    };

    room.on(RoomEvent.DataReceived, handleDataReceived);

    return () => {
      room.off(RoomEvent.DataReceived, handleDataReceived);
    };
  }, [room, options.enabled, localParticipant, processTTSQueue]);

  return {
    sendTranslation,
    incomingTranslations,
    isProcessing,
    error,
    muteRawAudio,
    unmuteRawAudio,
    mutedParticipants,
    analyser: analyserRef.current,
  };
}
