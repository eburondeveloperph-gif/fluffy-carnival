import { useState, useRef, useCallback, useEffect } from 'react';
import { supabase } from '../services/supabaseClient';

interface UseRealtimeTranslationOptions {
  meetingId: string | null;
  myUserId: string;
  targetLanguage: string;
  enabled: boolean; // Only process when in listening mode
}

interface TranslationItem {
  id: string;
  originalText: string;
  translatedText: string;
  audioBuffer?: ArrayBuffer;
  status: 'pending' | 'translating' | 'synthesizing' | 'ready' | 'playing' | 'completed';
}

/**
 * Hook for real-time translation with WebSocket (via Supabase Realtime)
 *
 * Flow:
 * 1. Speaker's STT text → Supabase Realtime (WebSocket)
 * 2. Listener receives text → Translate via API
 * 3. Translated text → TTS via API
 * 4. Audio queued and played sequentially
 */
export function useRealtimeTranslation(options: UseRealtimeTranslationOptions) {
  const { meetingId, myUserId, targetLanguage, enabled } = options;

  const [items, setItems] = useState<TranslationItem[]>([]);
  const [currentText, setCurrentText] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);

  const queueRef = useRef<TranslationItem[]>([]);
  const processingRef = useRef(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const channelRef = useRef<any>(null);

  // Initialize AudioContext
  const ensureAudioContext = useCallback(() => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    if (audioContextRef.current.state === 'suspended') {
      audioContextRef.current.resume();
    }
    return audioContextRef.current;
  }, []);

  // Process next item in queue
  const processNext = useCallback(async () => {
    if (processingRef.current || queueRef.current.length === 0) return;
    processingRef.current = true;
    setIsProcessing(true);

    const item = queueRef.current.shift();
    if (!item) {
      processingRef.current = false;
      setIsProcessing(false);
      return;
    }

    try {
      console.log(`[RealtimeTranslation] Processing: "${item.originalText}"`);

      // Step 1: Translate
      setCurrentText(item.originalText);
      const translationRes = await fetch('/api/orbit/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: item.originalText,
          targetLang: targetLanguage,
        }),
      });

      if (!translationRes.ok) throw new Error('Translation failed');
      const { translation } = await translationRes.json();

      console.log(`[RealtimeTranslation] Translated: "${translation}"`);
      setCurrentText(translation);

      // Update item status
      setItems((prev) =>
        prev.map((i) =>
          i.id === item.id ? { ...i, translatedText: translation, status: 'synthesizing' } : i,
        ),
      );

      // Step 2: TTS
      const ttsRes = await fetch('/api/orbit/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: translation }),
      });

      if (!ttsRes.ok) throw new Error('TTS failed');
      const audioBuffer = await ttsRes.arrayBuffer();

      // Update item with audio
      const updatedItem = {
        ...item,
        translatedText: translation,
        audioBuffer,
        status: 'ready' as const,
      };
      setItems((prev) => prev.map((i) => (i.id === item.id ? updatedItem : i)));

      // Step 3: Play audio
      await playAudio(audioBuffer);

      // Mark completed
      setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, status: 'completed' } : i)));
    } catch (error) {
      console.error('[RealtimeTranslation] Error:', error);
      setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, status: 'completed' } : i)));
    } finally {
      processingRef.current = false;
      setIsProcessing(false);
      // Process next item
      processNext();
    }
  }, [targetLanguage]);

  // Play audio buffer
  const playAudio = useCallback(
    async (buffer: ArrayBuffer): Promise<void> => {
      return new Promise((resolve, reject) => {
        const audioCtx = ensureAudioContext();
        if (!audioCtx) {
          reject(new Error('AudioContext not available'));
          return;
        }

        setIsPlaying(true);

        audioCtx.decodeAudioData(
          buffer,
          (audioBuffer) => {
            const source = audioCtx.createBufferSource();
            source.buffer = audioBuffer;
            source.connect(audioCtx.destination);

            source.onended = () => {
              setIsPlaying(false);
              resolve();
            };

            source.start();
          },
          (error) => {
            setIsPlaying(false);
            reject(error);
          },
        );
      });
    },
    [ensureAudioContext],
  );

  // Subscribe to transcriptions via WebSocket (Supabase Realtime)
  useEffect(() => {
    if (!meetingId || !enabled) return;

    console.log(`[RealtimeTranslation] Subscribing to meeting: ${meetingId}`);

    const channel = supabase
      .channel(`realtime-translation:${meetingId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'transcriptions',
          filter: `meeting_id=eq.${meetingId}`,
        },
        (payload: any) => {
          const transcription = payload.new;

          // Only process other speakers' transcriptions
          if (transcription.speaker_id !== myUserId && transcription.transcribe_text_segment) {
            console.log(
              `[RealtimeTranslation] Received: "${transcription.transcribe_text_segment}"`,
            );

            const newItem: TranslationItem = {
              id: transcription.id || `item-${Date.now()}`,
              originalText: transcription.transcribe_text_segment,
              translatedText: '',
              status: 'pending',
            };

            queueRef.current.push(newItem);
            setItems((prev) => [...prev, newItem]);

            // Trigger processing
            processNext();
          }
        },
      )
      .subscribe();

    channelRef.current = channel;

    return () => {
      console.log('[RealtimeTranslation] Unsubscribing');
      supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [meetingId, myUserId, enabled, processNext]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
    };
  }, []);

  return {
    items,
    currentText,
    isProcessing,
    isPlaying,
    queueLength: queueRef.current.length,
  };
}

export default useRealtimeTranslation;
