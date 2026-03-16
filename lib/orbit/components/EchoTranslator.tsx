'use client';

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Mic, MicOff, Volume2, VolumeX, Globe, Languages } from 'lucide-react';
import { LANGUAGES } from '@/lib/orbit/types';
import { SERVICE_ALIASES } from '@/lib/orbit/config/serviceAliases';

interface EchoTranslatorProps {
  apiKey?: string;
  className?: string;
}

/**
 * Echo Translator - Simplified UI
 *
 * MIC BUTTON: Enables transcription (uses selected language for STT)
 * SPEAKER BUTTON: Enables translation (suppresses original, plays TTS)
 * LANGUAGE DROPDOWN: Selects both STT language AND translation target
 */

export function EchoTranslator({ apiKey, className = '' }: EchoTranslatorProps) {
  // State
  const [isConnected, setIsConnected] = useState(false);
  const [isMicEnabled, setIsMicEnabled] = useState(false);
  const [isTranslationEnabled, setIsTranslationEnabled] = useState(false);
  const [selectedLanguage, setSelectedLanguage] = useState(LANGUAGES[0]); // Default: English
  const [showLanguageDropdown, setShowLanguageDropdown] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [status, setStatus] = useState('Click mic to start');
  const [error, setError] = useState<string | null>(null);

  // Refs
  const sessionRef = useRef<any>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const inputCtxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const audioQueueRef = useRef<Uint8Array[]>([]);
  const isPlayingRef = useRef(false);
  const clientRef = useRef<any>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowLanguageDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  /**
   * Decode base64 PCM to Uint8Array
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
   * Play audio queue (TTS output)
   */
  const playAudioQueue = useCallback(async () => {
    if (isPlayingRef.current || audioQueueRef.current.length === 0) return;
    if (!isTranslationEnabled) {
      audioQueueRef.current = []; // Clear if translation disabled
      return;
    }

    isPlayingRef.current = true;
    const ctx = audioCtxRef.current;
    if (!ctx) {
      isPlayingRef.current = false;
      return;
    }

    while (audioQueueRef.current.length > 0) {
      const chunk = audioQueueRef.current.shift();
      if (!chunk) continue;

      try {
        const int16 = new Int16Array(chunk.buffer);
        const audioBuffer = ctx.createBuffer(1, int16.length, 24000);
        const channelData = audioBuffer.getChannelData(0);
        for (let i = 0; i < int16.length; i++) {
          channelData[i] = int16[i] / 32768;
        }

        const source = ctx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(ctx.destination);

        await new Promise<void>((resolve) => {
          source.onended = () => resolve();
          source.start();
        });
      } catch (e) {
        console.error('[Echo] Audio playback error:', e);
      }
    }

    isPlayingRef.current = false;
  }, [isTranslationEnabled]);

  /**
   * Connect to Echo
   */
  const connect = useCallback(async () => {
    try {
      setStatus('Connecting...');
      setError(null);

      // Output audio context (for TTS)
      audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({
        sampleRate: 24000,
      });

      const key = apiKey || process.env.NEXT_PUBLIC_GEMINI_API_KEY;
      if (!key) {
        throw new Error('API key required');
      }

      // Dynamic import Google GenAI
      const { GoogleGenAI, Modality } = await import('@google/genai');
      clientRef.current = new GoogleGenAI({ apiKey: key });

      // System prompt - uses selected language for both input and output
      const langName = selectedLanguage.name;
      const systemPrompt = `You are ${SERVICE_ALIASES.ECHO.name}, a real-time speech translator.

Input language: ${langName}
Output language: ${langName}

When you hear speech in ${langName}:
1. Transcribe it accurately in ${langName}
2. Translate it to ${langName} (same language, just rephrase naturally)
3. Speak the translation naturally

Format your response:
[${langName.toUpperCase()}]: <natural rephrasing>

Speak the translation as a native ${langName} speaker would.`;

      // Connect to Live API
      const sessionPromise = clientRef.current.live.connect({
        model: 'models/gemini-2.5-flash-native-audio-preview-12-2025',
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
            setStatus('Connected');
            setIsConnected(true);
          },
          onmessage: async (msg: any) => {
            // Handle transcription
            if (msg.serverContent?.outputTranscription) {
              const text = msg.serverContent.outputTranscription.text;
              if (text) {
                setTranscript(text);
              }
            }

            // Handle model response
            if (msg.serverContent?.modelTurn?.parts) {
              for (const part of msg.serverContent.modelTurn.parts) {
                if (part.text) {
                  setTranscript(part.text);
                }
                if (part.inlineData?.data) {
                  const pcmData = decodeBase64(part.inlineData.data);
                  audioQueueRef.current.push(pcmData);
                }
              }
            }

            // Turn complete - play audio
            if (msg.serverContent?.turnComplete) {
              playAudioQueue();
            }
          },
          onclose: () => {
            setStatus('Disconnected');
            setIsConnected(false);
            setIsMicEnabled(false);
          },
          onerror: (e: any) => {
            const msg = e?.message || 'Connection error';
            setError(msg);
            setStatus('Error');
          },
        },
      });

      sessionRef.current = await sessionPromise;
    } catch (e: any) {
      setError(e.message || 'Failed to connect');
      setStatus('Error');
    }
  }, [apiKey, selectedLanguage, decodeBase64, playAudioQueue]);

  /**
   * Disconnect
   */
  const disconnect = useCallback(() => {
    sessionRef.current?.close?.();
    sessionRef.current = null;
    audioCtxRef.current?.close?.();
    audioCtxRef.current = null;
    inputCtxRef.current?.close?.();
    inputCtxRef.current = null;
    clientRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    audioQueueRef.current = [];
    setIsConnected(false);
    setIsMicEnabled(false);
    setStatus('Disconnected');
  }, []);

  /**
   * Start microphone
   */
  const startMic = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 16000,
        },
      });
      streamRef.current = stream;

      // Input audio context
      inputCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({
        sampleRate: 16000,
      });

      const source = inputCtxRef.current.createMediaStreamSource(stream);
      const processor = inputCtxRef.current.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;

      processor.onaudioprocess = (e) => {
        if (!isConnected || !sessionRef.current) return;

        const input = e.inputBuffer.getChannelData(0);
        const pcm16 = new Int16Array(input.length);
        for (let i = 0; i < input.length; i++) {
          pcm16[i] = Math.max(-1, Math.min(1, input[i])) * 0x7fff;
        }

        const base64 = btoa(String.fromCharCode(...new Uint8Array(pcm16.buffer)));
        sessionRef.current.sendRealtimeInput({
          audio: { mimeType: 'audio/pcm;rate=16000', data: base64 },
        });
      };

      source.connect(processor);
      processor.connect(inputCtxRef.current.destination);

      setIsMicEnabled(true);
      setStatus('Listening...');
    } catch (e: any) {
      setError('Microphone access denied');
    }
  }, [isConnected]);

  /**
   * Stop microphone
   */
  const stopMic = useCallback(() => {
    processorRef.current?.disconnect();
    processorRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    inputCtxRef.current?.close();
    inputCtxRef.current = null;
    setIsMicEnabled(false);
    setStatus(isConnected ? 'Connected' : 'Disconnected');
  }, [isConnected]);

  /**
   * Handle mic toggle
   */
  const handleMicToggle = useCallback(async () => {
    if (!isConnected) {
      await connect();
      // Auto-start mic after connecting
      setTimeout(() => startMic(), 100);
    } else if (isMicEnabled) {
      stopMic();
    } else {
      await startMic();
    }
  }, [isConnected, isMicEnabled, connect, startMic, stopMic]);

  /**
   * Handle translation toggle
   */
  const handleTranslationToggle = useCallback(() => {
    setIsTranslationEnabled((prev) => !prev);
    if (!isTranslationEnabled) {
      // Enabling translation - clear any queued original audio
      audioQueueRef.current = [];
    }
  }, [isTranslationEnabled]);

  /**
   * Handle language change
   */
  const handleLanguageChange = useCallback((lang: (typeof LANGUAGES)[0]) => {
    setSelectedLanguage(lang);
    setShowLanguageDropdown(false);
  }, []);

  /**
   * Cleanup on unmount
   */
  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  return (
    <div
      className={`bg-slate-900/95 backdrop-blur-xl rounded-2xl border border-white/10 p-4 ${className}`}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div
            className={`w-8 h-8 rounded-lg flex items-center justify-center ${
              isConnected ? 'bg-gradient-to-br from-emerald-500 to-teal-600' : 'bg-slate-700'
            }`}
          >
            <Globe className="w-4 h-4 text-white" />
          </div>
          <div>
            <h3 className="text-white text-sm font-semibold">{SERVICE_ALIASES.ECHO.name}</h3>
            <p className="text-xs text-slate-500">{status}</p>
          </div>
        </div>

        {/* Connection status */}
        <div
          className={`px-2 py-1 rounded-full text-xs ${
            isConnected ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-700 text-slate-400'
          }`}
        >
          {isConnected ? 'Online' : 'Offline'}
        </div>
      </div>

      {/* Transcript Display */}
      <div className="mb-4 min-h-[80px] bg-slate-800/50 rounded-xl p-4">
        {transcript ? (
          <p className="text-white/90 text-sm leading-relaxed whitespace-pre-wrap">{transcript}</p>
        ) : (
          <p className="text-slate-500 text-sm text-center">
            {isMicEnabled ? 'Listening...' : 'Enable mic to start'}
          </p>
        )}
      </div>

      {/* Language Dropdown */}
      <div className="mb-4 relative" ref={dropdownRef}>
        <button
          onClick={() => setShowLanguageDropdown(!showLanguageDropdown)}
          className="w-full flex items-center justify-between px-4 py-3 bg-slate-800/50 rounded-xl border border-white/5 hover:border-white/10 transition-colors"
        >
          <div className="flex items-center gap-2">
            <Languages className="w-4 h-4 text-slate-400" />
            <span className="text-sm text-white">
              {selectedLanguage.flag} {selectedLanguage.name}
            </span>
          </div>
          <span className="text-xs text-slate-500">▼</span>
        </button>

        {showLanguageDropdown && (
          <div className="absolute top-full left-0 right-0 mt-2 bg-slate-800 rounded-xl border border-white/10 shadow-xl z-10 max-h-60 overflow-y-auto">
            {LANGUAGES.map((lang) => (
              <button
                key={lang.code}
                onClick={() => handleLanguageChange(lang)}
                className={`w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-white/5 transition-colors ${
                  selectedLanguage.code === lang.code
                    ? 'bg-emerald-500/10 text-emerald-400'
                    : 'text-white/80'
                }`}
              >
                <span>{lang.flag}</span>
                <span className="text-sm">{lang.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Control Buttons */}
      <div className="flex items-center justify-center gap-4">
        {/* Mic Button */}
        <button
          onClick={handleMicToggle}
          className={`
            relative w-16 h-16 rounded-full flex items-center justify-center transition-all
            ${
              isMicEnabled
                ? 'bg-gradient-to-br from-emerald-500 to-teal-600 shadow-lg shadow-emerald-500/30'
                : isConnected
                  ? 'bg-gradient-to-br from-slate-600 to-slate-700 hover:from-slate-500 hover:to-slate-600'
                  : 'bg-gradient-to-br from-blue-500 to-indigo-600 shadow-lg shadow-blue-500/30'
            }
          `}
          title={isMicEnabled ? 'Stop microphone' : 'Start microphone'}
        >
          {isMicEnabled ? (
            <Mic className="w-7 h-7 text-white" />
          ) : (
            <MicOff className="w-7 h-7 text-white" />
          )}

          {/* Recording indicator */}
          {isMicEnabled && (
            <div className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full animate-pulse" />
          )}
        </button>

        {/* Translation Toggle Button */}
        <button
          onClick={handleTranslationToggle}
          disabled={!isConnected}
          className={`
            relative w-16 h-16 rounded-full flex items-center justify-center transition-all
            ${
              isTranslationEnabled
                ? 'bg-gradient-to-br from-purple-500 to-pink-600 shadow-lg shadow-purple-500/30'
                : 'bg-gradient-to-br from-slate-600 to-slate-700 hover:from-slate-500 hover:to-slate-600'
            }
            ${!isConnected ? 'opacity-50 cursor-not-allowed' : ''}
          `}
          title={
            isTranslationEnabled
              ? 'Disable translation (hear original)'
              : 'Enable translation (suppress original)'
          }
        >
          {isTranslationEnabled ? (
            <Volume2 className="w-7 h-7 text-white" />
          ) : (
            <VolumeX className="w-7 h-7 text-white" />
          )}
        </button>
      </div>

      {/* Labels */}
      <div className="flex items-center justify-center gap-8 mt-3">
        <span className="text-xs text-slate-500">{isMicEnabled ? 'Listening' : 'Mic'}</span>
        <span className="text-xs text-slate-500">
          {isTranslationEnabled ? 'Translating' : 'Original'}
        </span>
      </div>

      {/* Error Display */}
      {error && (
        <div className="mt-4 p-3 bg-red-500/10 border border-red-500/20 rounded-xl">
          <p className="text-xs text-red-400">{error}</p>
        </div>
      )}

      {/* Info */}
      <div className="mt-4 text-center">
        <p className="text-xs text-slate-600">
          Mic: STT in {selectedLanguage.name}
          {isTranslationEnabled && ` • Translation enabled`}
        </p>
      </div>
    </div>
  );
}

export default EchoTranslator;
