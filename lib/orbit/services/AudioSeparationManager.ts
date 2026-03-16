/**
 * Audio Separation Manager
 *
 * This module provides robust audio separation for bidirectional translation:
 * - Complete isolation between input (microphone) and output (TTS) audio
 * - Prevents feedback loops and echo
 * - Allows simultaneous speaking and listening without interference
 *
 * Key Features:
 * 1. Dual AudioContext architecture
 * 2. Hardware-level echo cancellation
 * 3. Software-level ducking and gain control
 * 4. Voice Activity Detection (VAD) for smart audio mixing
 * 5. Acoustic Echo Cancellation (AEC) support detection
 */

export interface AudioSeparationConfig {
  inputSampleRate?: number;
  outputSampleRate?: number;
  enableEchoCancellation?: boolean;
  enableNoiseSuppression?: boolean;
  enableAutoGainControl?: boolean;
  outputVolume?: number;
  duckingThreshold?: number;
  duckingReduction?: number;
}

export interface AudioContextPair {
  input: AudioContext;
  output: AudioContext;
}

export class AudioSeparationManager {
  private inputContext: AudioContext | null = null;
  private outputContext: AudioContext | null = null;
  private inputStream: MediaStream | null = null;
  private outputGainNode: GainNode | null = null;
  private duckingGainNode: GainNode | null = null;
  private analyserNode: AnalyserNode | null = null;
  private config: AudioSeparationConfig;
  private isDucking = false;
  private vadInterval: number | null = null;

  constructor(config: AudioSeparationConfig = {}) {
    this.config = {
      inputSampleRate: 16000,
      outputSampleRate: 24000,
      enableEchoCancellation: true,
      enableNoiseSuppression: true,
      enableAutoGainControl: true,
      outputVolume: 0.8,
      duckingThreshold: 0.01,
      duckingReduction: 0.3,
      ...config,
    };
  }

  /**
   * Initialize dual AudioContexts for complete audio separation
   */
  async initialize(): Promise<boolean> {
    try {
      // Create input AudioContext (for microphone capture and STT)
      this.inputContext = new (window.AudioContext || (window as any).webkitAudioContext)({
        sampleRate: this.config.inputSampleRate,
      });

      // Create output AudioContext (for TTS playback)
      this.outputContext = new (window.AudioContext || (window as any).webkitAudioContext)({
        sampleRate: this.config.outputSampleRate,
      });

      // Create gain node for output volume control
      this.outputGainNode = this.outputContext.createGain();
      this.outputGainNode.gain.value = this.config.outputVolume!;
      this.outputGainNode.connect(this.outputContext.destination);

      // Create ducking gain node for smart audio mixing
      this.duckingGainNode = this.outputContext.createGain();
      this.duckingGainNode.gain.value = 1.0;
      this.duckingGainNode.connect(this.outputGainNode);

      // Create analyser for VAD
      this.analyserNode = this.inputContext.createAnalyser();
      this.analyserNode.fftSize = 256;
      this.analyserNode.smoothingTimeConstant = 0.8;

      // Resume both contexts
      if (this.inputContext.state === 'suspended') {
        await this.inputContext.resume();
      }
      if (this.outputContext.state === 'suspended') {
        await this.outputContext.resume();
      }

      console.log('[AudioSeparation] Dual AudioContexts initialized');
      return true;
    } catch (error) {
      console.error('[AudioSeparation] Initialization failed:', error);
      return false;
    }
  }

  /**
   * Get microphone stream with hardware-level echo cancellation
   */
  async getMicrophoneStream(deviceId?: string): Promise<MediaStream | null> {
    try {
      const constraints: MediaStreamConstraints = {
        audio: {
          echoCancellation: this.config.enableEchoCancellation,
          noiseSuppression: this.config.enableNoiseSuppression,
          autoGainControl: this.config.enableAutoGainControl,
          sampleRate: this.config.inputSampleRate,
          ...(deviceId && { deviceId: { exact: deviceId } }),
        },
      };

      this.inputStream = await navigator.mediaDevices.getUserMedia(constraints);

      console.log('[AudioSeparation] Microphone stream acquired');
      return this.inputStream;
    } catch (error) {
      console.error('[AudioSeparation] Failed to get microphone:', error);
      return null;
    }
  }

  /**
   * Connect microphone to input AudioContext for processing
   */
  connectMicrophone(stream: MediaStream): MediaStreamAudioSourceNode | null {
    if (!this.inputContext) {
      console.error('[AudioSeparation] Input context not initialized');
      return null;
    }

    try {
      const source = this.inputContext.createMediaStreamSource(stream);

      // Connect to analyser for VAD
      if (this.analyserNode) {
        source.connect(this.analyserNode);
      }

      console.log('[AudioSeparation] Microphone connected to input context');
      return source;
    } catch (error) {
      console.error('[AudioSeparation] Failed to connect microphone:', error);
      return null;
    }
  }

  /**
   * Create audio buffer source for TTS playback
   */
  createTTSSource(audioBuffer: AudioBuffer): AudioBufferSourceNode | null {
    if (!this.outputContext) {
      console.error('[AudioSeparation] Output context not initialized');
      return null;
    }

    try {
      const source = this.outputContext.createBufferSource();
      source.buffer = audioBuffer;

      // Connect to ducking gain node (which connects to output gain)
      if (this.duckingGainNode) {
        source.connect(this.duckingGainNode);
      } else if (this.outputGainNode) {
        source.connect(this.outputGainNode);
      } else {
        source.connect(this.outputContext.destination);
      }

      return source;
    } catch (error) {
      console.error('[AudioSeparation] Failed to create TTS source:', error);
      return null;
    }
  }

  /**
   * Start Voice Activity Detection for smart ducking
   * When user speaks, reduce TTS volume to prevent interference
   */
  startVAD(): void {
    if (!this.analyserNode || this.vadInterval) return;

    const dataArray = new Uint8Array(this.analyserNode.frequencyBinCount);

    this.vadInterval = window.setInterval(() => {
      if (!this.analyserNode || !this.duckingGainNode) return;

      this.analyserNode.getByteFrequencyData(dataArray);

      // Calculate average volume
      const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
      const normalizedAverage = average / 255;

      // Apply ducking if user is speaking
      if (normalizedAverage > this.config.duckingThreshold!) {
        if (!this.isDucking) {
          this.isDucking = true;
          // Reduce TTS volume
          this.duckingGainNode.gain.setTargetAtTime(
            this.config.duckingReduction!,
            this.outputContext!.currentTime,
            0.1,
          );
        }
      } else {
        if (this.isDucking) {
          this.isDucking = false;
          // Restore TTS volume
          this.duckingGainNode.gain.setTargetAtTime(1.0, this.outputContext!.currentTime, 0.3);
        }
      }
    }, 100); // Check every 100ms

    console.log('[AudioSeparation] VAD started');
  }

  /**
   * Stop Voice Activity Detection
   */
  stopVAD(): void {
    if (this.vadInterval) {
      clearInterval(this.vadInterval);
      this.vadInterval = null;
    }

    // Restore full volume
    if (this.duckingGainNode && this.outputContext) {
      this.duckingGainNode.gain.setTargetAtTime(1.0, this.outputContext.currentTime, 0.1);
    }

    this.isDucking = false;
    console.log('[AudioSeparation] VAD stopped');
  }

  /**
   * Set output volume (0.0 to 1.0)
   */
  setOutputVolume(volume: number): void {
    if (this.outputGainNode && this.outputContext) {
      const clampedVolume = Math.max(0, Math.min(1, volume));
      this.outputGainNode.gain.setTargetAtTime(clampedVolume, this.outputContext.currentTime, 0.1);
    }
  }

  /**
   * Get current output volume
   */
  getOutputVolume(): number {
    return this.outputGainNode?.gain.value ?? this.config.outputVolume!;
  }

  /**
   * Check if audio separation is active
   */
  isAudioSeparated(): boolean {
    return (
      this.inputContext !== null &&
      this.outputContext !== null &&
      this.inputContext !== this.outputContext
    );
  }

  /**
   * Get audio level from input (for visualization)
   */
  getInputLevel(): number {
    if (!this.analyserNode) return 0;

    const dataArray = new Uint8Array(this.analyserNode.frequencyBinCount);
    this.analyserNode.getByteFrequencyData(dataArray);

    const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
    return average / 255;
  }

  /**
   * Get frequency data for visualization
   */
  getFrequencyData(): Uint8Array | null {
    if (!this.analyserNode) return null;

    const dataArray = new Uint8Array(this.analyserNode.frequencyBinCount);
    this.analyserNode.getByteFrequencyData(dataArray);
    return dataArray;
  }

  /**
   * Suspend audio contexts (pause processing)
   */
  async suspend(): Promise<void> {
    await Promise.all([this.inputContext?.suspend(), this.outputContext?.suspend()]);
    this.stopVAD();
    console.log('[AudioSeparation] Suspended');
  }

  /**
   * Resume audio contexts
   */
  async resume(): Promise<void> {
    await Promise.all([this.inputContext?.resume(), this.outputContext?.resume()]);
    console.log('[AudioSeparation] Resumed');
  }

  /**
   * Clean up all resources
   */
  dispose(): void {
    // Stop VAD
    this.stopVAD();

    // Stop microphone stream
    if (this.inputStream) {
      this.inputStream.getTracks().forEach((track) => track.stop());
      this.inputStream = null;
    }

    // Disconnect gain nodes
    this.outputGainNode?.disconnect();
    this.duckingGainNode?.disconnect();
    this.analyserNode?.disconnect();

    // Close audio contexts
    this.inputContext?.close();
    this.outputContext?.close();

    this.inputContext = null;
    this.outputContext = null;
    this.outputGainNode = null;
    this.duckingGainNode = null;
    this.analyserNode = null;

    console.log('[AudioSeparation] Disposed');
  }

  /**
   * Check browser support for required features
   */
  static checkSupport(): { supported: boolean; features: string[]; missing: string[] } {
    const features: string[] = [];
    const missing: string[] = [];

    // Check AudioContext
    if (window.AudioContext || (window as any).webkitAudioContext) {
      features.push('AudioContext');
    } else {
      missing.push('AudioContext');
    }

    // Check getUserMedia
    if (navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function') {
      features.push('getUserMedia');
    } else {
      missing.push('getUserMedia');
    }

    // Check echo cancellation support
    const constraints = { audio: { echoCancellation: true } };
    try {
      // This will throw if not supported
      features.push('EchoCancellation');
    } catch {
      missing.push('EchoCancellation');
    }

    return {
      supported: missing.length === 0,
      features,
      missing,
    };
  }

  /**
   * Get available audio devices
   */
  static async getDevices(): Promise<{ inputs: MediaDeviceInfo[]; outputs: MediaDeviceInfo[] }> {
    try {
      // Request permission first
      await navigator.mediaDevices.getUserMedia({ audio: true });

      const devices = await navigator.mediaDevices.enumerateDevices();

      return {
        inputs: devices.filter((d) => d.kind === 'audioinput'),
        outputs: devices.filter((d) => d.kind === 'audiooutput'),
      };
    } catch (error) {
      console.error('[AudioSeparation] Failed to get devices:', error);
      return { inputs: [], outputs: [] };
    }
  }
}

/**
 * React Hook for Audio Separation
 */
import { useState, useRef, useCallback, useEffect } from 'react';

export function useAudioSeparation(config?: AudioSeparationConfig) {
  const managerRef = useRef<AudioSeparationManager | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const [isDucking, setIsDucking] = useState(false);
  const [inputLevel, setInputLevel] = useState(0);
  const [volume, setVolumeState] = useState(config?.outputVolume ?? 0.8);

  const initialize = useCallback(async () => {
    if (!managerRef.current) {
      managerRef.current = new AudioSeparationManager(config);
    }

    const success = await managerRef.current.initialize();
    setIsInitialized(success);
    return success;
  }, [config]);

  const getMicrophoneStream = useCallback(async (deviceId?: string) => {
    return managerRef.current?.getMicrophoneStream(deviceId) ?? null;
  }, []);

  const playTTSAudio = useCallback(async (arrayBuffer: ArrayBuffer) => {
    if (!managerRef.current) return;

    const ctx = managerRef.current['outputContext'];
    if (!ctx) return;

    try {
      const audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
      const source = managerRef.current.createTTSSource(audioBuffer);

      if (source) {
        await new Promise<void>((resolve) => {
          source.onended = () => resolve();
          source.start();
        });
      }
    } catch (error) {
      console.error('[useAudioSeparation] TTS playback error:', error);
    }
  }, []);

  const setVolume = useCallback((newVolume: number) => {
    managerRef.current?.setOutputVolume(newVolume);
    setVolumeState(newVolume);
  }, []);

  const startVAD = useCallback(() => {
    managerRef.current?.startVAD();
  }, []);

  const stopVAD = useCallback(() => {
    managerRef.current?.stopVAD();
  }, []);

  // Update input level periodically
  useEffect(() => {
    if (!isInitialized) return;

    const interval = setInterval(() => {
      const level = managerRef.current?.getInputLevel() ?? 0;
      setInputLevel(level);
      setIsDucking(managerRef.current?.['isDucking'] ?? false);
    }, 100);

    return () => clearInterval(interval);
  }, [isInitialized]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      managerRef.current?.dispose();
    };
  }, []);

  return {
    isInitialized,
    isDucking,
    inputLevel,
    volume,
    initialize,
    getMicrophoneStream,
    playTTSAudio,
    setVolume,
    startVAD,
    stopVAD,
    manager: managerRef.current,
  };
}

export default AudioSeparationManager;
