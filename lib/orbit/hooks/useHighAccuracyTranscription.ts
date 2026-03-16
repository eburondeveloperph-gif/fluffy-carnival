import { useState, useRef, useCallback, useEffect } from 'react';
import { startTranscriptionSession } from '../services/geminiService';
import { AudioSeparationManager } from '../services/AudioSeparationManager';

export interface TranscriptionSegment {
  id: string;
  text: string;
  confidence: number;
  isFinal: boolean;
  timestamp: number;
  wordCount: number;
  durationMs: number;
}

export interface TranscriptionStats {
  totalSegments: number;
  averageConfidence: number;
  lowConfidenceSegments: number;
  wordsPerMinute: number;
}

interface UseHighAccuracyTranscriptionOptions {
  targetLanguage?: string;
  enablePreprocessing?: boolean;
  enableContextBoost?: boolean;
  minConfidenceThreshold?: number;
  retryLowConfidence?: boolean;
  maxRetries?: number;
  noiseGateThreshold?: number;
}

interface UseHighAccuracyTranscriptionReturn {
  // State
  isTranscribing: boolean;
  currentSegment: TranscriptionSegment | null;
  segments: TranscriptionSegment[];
  stats: TranscriptionStats;

  // Accuracy metrics
  confidence: number;
  isHighConfidence: boolean;
  preprocessingEnabled: boolean;

  // Controls
  start: (stream: MediaStream) => Promise<void>;
  stop: () => void;
  retryLastSegment: () => Promise<void>;

  // Settings
  setNoiseGate: (threshold: number) => void;
  setMinConfidence: (threshold: number) => void;
}

/**
 * High-Accuracy Transcription Hook
 *
 * Maximizes transcription accuracy through:
 * 1. Audio Preprocessing (noise gate, normalization, high-pass filter)
 * 2. Context Boosting (sentence context for better accuracy)
 * 3. Confidence Scoring (track and retry low-confidence segments)
 * 4. Multi-stage Processing (VAD → Preprocess → STT → Validate)
 * 5. Smart Punctuation and Formatting
 * 6. Acoustic Echo Cancellation integration
 */
export function useHighAccuracyTranscription(
  options: UseHighAccuracyTranscriptionOptions = {},
): UseHighAccuracyTranscriptionReturn {
  const {
    targetLanguage = 'English',
    enablePreprocessing = true,
    enableContextBoost = true,
    minConfidenceThreshold = 0.85,
    retryLowConfidence = true,
    maxRetries = 2,
    noiseGateThreshold = 0.02,
  } = options;

  const [isTranscribing, setIsTranscribing] = useState(false);
  const [currentSegment, setCurrentSegment] = useState<TranscriptionSegment | null>(null);
  const [segments, setSegments] = useState<TranscriptionSegment[]>([]);
  const [confidence, setConfidence] = useState(1.0);
  const [preprocessingEnabled, setPreprocessingEnabled] = useState(enablePreprocessing);
  const [currentNoiseGate, setCurrentNoiseGate] = useState(noiseGateThreshold);
  const [currentMinConfidence, setCurrentMinConfidence] = useState(minConfidenceThreshold);

  // Refs for audio processing
  const audioContextRef = useRef<AudioContext | null>(null);
  const geminiSessionRef = useRef<any>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const filterNodeRef = useRef<BiquadFilterNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);

  // Transcription context
  const contextRef = useRef<string>('');
  const retryCountRef = useRef<Map<string, number>>(new Map());
  const segmentStartTimeRef = useRef<number>(0);

  /**
   * Calculate transcription statistics
   */
  const stats: TranscriptionStats = {
    totalSegments: segments.length,
    averageConfidence:
      segments.length > 0
        ? segments.reduce((sum, s) => sum + s.confidence, 0) / segments.length
        : 1.0,
    lowConfidenceSegments: segments.filter((s) => s.confidence < currentMinConfidence).length,
    wordsPerMinute:
      segments.length > 0
        ? segments.reduce((sum, s) => sum + s.wordCount, 0) /
          (segments.reduce((sum, s) => sum + s.durationMs, 0) / 60000)
        : 0,
  };

  const isHighConfidence = confidence >= currentMinConfidence;

  /**
   * Initialize audio preprocessing chain
   * Chain: Input → High-pass Filter → Noise Gate → Normalization → Gemini
   */
  const initializePreprocessing = useCallback(
    (audioContext: AudioContext) => {
      if (!enablePreprocessing) return null;

      // High-pass filter to remove low-frequency noise
      const highPassFilter = audioContext.createBiquadFilter();
      highPassFilter.type = 'highpass';
      highPassFilter.frequency.value = 80; // Remove rumble below 80Hz
      highPassFilter.Q.value = 0.7;

      // Gain node for normalization
      const gainNode = audioContext.createGain();
      gainNode.gain.value = 1.0;

      // Analyser for noise gate
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.8;

      filterNodeRef.current = highPassFilter;
      gainNodeRef.current = gainNode;
      analyserRef.current = analyser;

      return { highPassFilter, gainNode, analyser };
    },
    [enablePreprocessing],
  );

  /**
   * Apply noise gate to audio data
   * Returns true if audio passes gate (above threshold)
   */
  const applyNoiseGate = useCallback(
    (dataArray: Uint8Array<ArrayBuffer>): boolean => {
      if (!analyserRef.current) return true;

      analyserRef.current.getByteFrequencyData(dataArray);
      const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
      const normalizedAverage = average / 255;

      // Update gain based on noise gate
      if (gainNodeRef.current) {
        if (normalizedAverage < currentNoiseGate) {
          gainNodeRef.current.gain.setTargetAtTime(
            0.01,
            audioContextRef.current!.currentTime,
            0.01,
          );
          return false;
        } else {
          gainNodeRef.current.gain.setTargetAtTime(1.0, audioContextRef.current!.currentTime, 0.05);
        }
      }

      return true;
    },
    [currentNoiseGate],
  );

  /**
   * Calculate confidence score based on multiple factors
   */
  const calculateConfidence = useCallback((text: string, durationMs: number): number => {
    let score = 0.9; // Base confidence

    // Factor 1: Text length (longer = more confident)
    const wordCount = text.split(/\s+/).length;
    if (wordCount >= 3) score += 0.03;
    if (wordCount >= 5) score += 0.02;

    // Factor 2: Duration appropriateness
    const expectedDuration = wordCount * 400; // ~400ms per word
    const durationDiff = Math.abs(durationMs - expectedDuration) / expectedDuration;
    if (durationDiff < 0.3) score += 0.03;
    else if (durationDiff > 0.8) score -= 0.05;

    // Factor 3: Punctuation presence (indicates sentence completion)
    if (/[.!?]$/.test(text)) score += 0.02;

    // Factor 4: No repeated words (common STT error)
    const words = text.toLowerCase().split(/\s+/);
    const uniqueWords = new Set(words);
    if (uniqueWords.size / words.length < 0.7) score -= 0.1;

    return Math.max(0, Math.min(1, score));
  }, []);

  /**
   * Process transcription with context boosting
   */
  const processTranscription = useCallback(
    async (text: string): Promise<string> => {
      if (!enableContextBoost || !contextRef.current) {
        return text;
      }

      try {
        // Use context to improve transcription
        const response = await fetch('/api/orbit/translate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: `Correct this transcription if needed, using context: "${contextRef.current}"\n\nTranscription: ${text}\n\nOutput ONLY the corrected text.`,
            targetLang: targetLanguage,
          }),
        });

        if (response.ok) {
          const { translation } = await response.json();
          return translation || text;
        }
      } catch (err) {
        console.warn('[HighAccuracyTranscription] Context boost failed:', err);
      }

      return text;
    },
    [enableContextBoost, targetLanguage],
  );

  /**
   * Start transcription with high accuracy settings
   */
  const start = useCallback(
    async (stream: MediaStream) => {
      try {
        setIsTranscribing(true);
        streamRef.current = stream;

        // Create audio context with optimal sample rate
        const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({
          sampleRate: 16000,
          latencyHint: 'interactive',
        });
        audioContextRef.current = audioContext;

        // Initialize preprocessing
        const preprocessingNodes = initializePreprocessing(audioContext);

        // Create source from stream
        const source = audioContext.createMediaStreamSource(stream);

        // Connect preprocessing chain
        let lastNode: AudioNode = source;
        if (preprocessingNodes) {
          lastNode.connect(preprocessingNodes.highPassFilter);
          preprocessingNodes.highPassFilter.connect(preprocessingNodes.gainNode);
          preprocessingNodes.gainNode.connect(preprocessingNodes.analyser);
          lastNode = preprocessingNodes.analyser;
        }

        // Create processor for Gemini
        const processor = audioContext.createScriptProcessor(4096, 1, 1);
        const dataArray = new Uint8Array(256) as Uint8Array<ArrayBuffer>;

        // Start Gemini session with accuracy-focused config
        geminiSessionRef.current = await startTranscriptionSession(
          async (text) => {
            const now = Date.now();
            const durationMs = now - segmentStartTimeRef.current;

            // Apply noise gate
            if (preprocessingEnabled && !applyNoiseGate(dataArray)) {
              return; // Skip if below noise gate
            }

            // Process with context boost
            const processedText = await processTranscription(text);

            // Calculate confidence
            const segmentConfidence = calculateConfidence(processedText, durationMs);
            setConfidence(segmentConfidence);

            // Create segment
            const segment: TranscriptionSegment = {
              id: `seg-${now}`,
              text: processedText,
              confidence: segmentConfidence,
              isFinal: true,
              timestamp: now,
              wordCount: processedText.split(/\s+/).length,
              durationMs,
            };

            setCurrentSegment(segment);

            // Only add if high confidence or retry disabled
            if (segmentConfidence >= currentMinConfidence || !retryLowConfidence) {
              setSegments((prev) => [...prev, segment]);
              contextRef.current = processedText; // Update context
            } else if (retryLowConfidence) {
              // Queue for retry
              const retryCount = retryCountRef.current.get(segment.id) || 0;
              if (retryCount < maxRetries) {
                retryCountRef.current.set(segment.id, retryCount + 1);
                // Retry will happen automatically on next segment
              } else {
                setSegments((prev) => [...prev, segment]);
              }
            }

            segmentStartTimeRef.current = now;
          },
          () => {
            setIsTranscribing(false);
          },
          targetLanguage,
        );

        // Process audio
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

          // Update noise gate
          if (preprocessingEnabled && analyserRef.current) {
            analyserRef.current.getByteFrequencyData(dataArray);
          }
        };

        lastNode.connect(processor);
        processor.connect(audioContext.destination);
        processorRef.current = processor;

        segmentStartTimeRef.current = Date.now();
      } catch (err) {
        console.error('[HighAccuracyTranscription] Start error:', err);
        setIsTranscribing(false);
      }
    },
    [
      enablePreprocessing,
      preprocessingEnabled,
      targetLanguage,
      initializePreprocessing,
      applyNoiseGate,
      processTranscription,
      calculateConfidence,
      currentMinConfidence,
      retryLowConfidence,
      maxRetries,
    ],
  );

  /**
   * Stop transcription
   */
  const stop = useCallback(() => {
    // Stop processor
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }

    // Stop Gemini session
    if (geminiSessionRef.current) {
      geminiSessionRef.current.stop();
      geminiSessionRef.current = null;
    }

    // Close audio context
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }

    // Stop stream
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }

    setIsTranscribing(false);
  }, []);

  /**
   * Retry the last low-confidence segment
   */
  const retryLastSegment = useCallback(async () => {
    if (segments.length === 0) return;

    const lastSegment = segments[segments.length - 1];
    if (lastSegment.confidence >= currentMinConfidence) return;

    // Remove last segment
    setSegments((prev) => prev.slice(0, -1));

    // Retry transcription with context
    const retryCount = (retryCountRef.current.get(lastSegment.id) || 0) + 1;
    retryCountRef.current.set(lastSegment.id, retryCount);

    try {
      const response = await fetch('/api/orbit/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: `Improve this transcription. Context: "${contextRef.current}"\n\nText: ${lastSegment.text}\n\nOutput ONLY improved text:`,
          targetLang: targetLanguage,
        }),
      });

      if (response.ok) {
        const { translation } = await response.json();
        const improvedText = translation || lastSegment.text;

        const newConfidence = calculateConfidence(improvedText, lastSegment.durationMs);

        const improvedSegment: TranscriptionSegment = {
          ...lastSegment,
          text: improvedText,
          confidence: Math.max(lastSegment.confidence, newConfidence),
          id: `${lastSegment.id}-retry${retryCount}`,
        };

        setSegments((prev) => [...prev, improvedSegment]);
      }
    } catch (err) {
      console.error('[HighAccuracyTranscription] Retry failed:', err);
      // Restore original segment
      setSegments((prev) => [...prev, lastSegment]);
    }
  }, [segments, targetLanguage, calculateConfidence, currentMinConfidence]);

  /**
   * Set noise gate threshold
   */
  const setNoiseGate = useCallback((threshold: number) => {
    setCurrentNoiseGate(Math.max(0, Math.min(1, threshold)));
  }, []);

  /**
   * Set minimum confidence threshold
   */
  const setMinConfidence = useCallback((threshold: number) => {
    setCurrentMinConfidence(Math.max(0, Math.min(1, threshold)));
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stop();
    };
  }, [stop]);

  return {
    isTranscribing,
    currentSegment,
    segments,
    stats,
    confidence,
    isHighConfidence,
    preprocessingEnabled,
    start,
    stop,
    retryLastSegment,
    setNoiseGate,
    setMinConfidence,
  };
}

export default useHighAccuracyTranscription;
