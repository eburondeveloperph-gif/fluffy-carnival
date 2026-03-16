import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useEcho } from '../hooks/useEcho';
import { Mic, MicOff, Volume2 } from 'lucide-react';
import { SERVICE_ALIASES, STATUS_MESSAGES } from '../config/serviceAliases';

interface EchoPanelProps {
  apiKey?: string;
  targetLanguage?: string;
  autoStart?: boolean;
  className?: string;
}

/**
 * Echo Panel - One-click real-time translation
 *
 * Single model does it all:
 * - Speak → See transcription
 * - Automatic translation spoken
 *
 * Click mic to start, speak in any language,
 * see transcription and hear translation automatically.
 */
export function EchoPanel({
  apiKey,
  targetLanguage = 'Spanish',
  autoStart = false,
  className = '',
}: EchoPanelProps) {
  const [transcript, setTranscript] = useState('');
  const audioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);

  const { isConnected, isSpeaking, status, error, connect, disconnect, sendAudio } = useEcho({
    apiKey,
    targetLanguage,
    onTranscript: setTranscript,
    onError: console.error,
  });

  // Start microphone capture
  const startMic = useCallback(async () => {
    try {
      // Get mic stream
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 16000,
        },
      });
      streamRef.current = stream;

      // Create audio context
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)({
        sampleRate: 16000,
      });
      audioContextRef.current = ctx;

      const source = ctx.createMediaStreamSource(stream);
      const processor = ctx.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;

      // Process audio
      processor.onaudioprocess = (e) => {
        if (!isConnected) return;

        const input = e.inputBuffer.getChannelData(0);

        // Convert Float32 to Int16 PCM
        const pcm16 = new Int16Array(input.length);
        for (let i = 0; i < input.length; i++) {
          pcm16[i] = Math.max(-1, Math.min(1, input[i])) * 0x7fff;
        }

        // Base64 encode and send
        const base64 = btoa(String.fromCharCode(...new Uint8Array(pcm16.buffer)));
        sendAudio(base64);
      };

      source.connect(processor);
      processor.connect(ctx.destination);
    } catch (e) {
      console.error('Mic error:', e);
    }
  }, [isConnected, sendAudio]);

  // Stop mic
  const stopMic = useCallback(() => {
    processorRef.current?.disconnect();
    processorRef.current = null;

    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;

    audioContextRef.current?.close();
    audioContextRef.current = null;
  }, []);

  // Toggle
  const handleToggle = useCallback(async () => {
    if (isConnected) {
      stopMic();
      disconnect();
      setTranscript('');
    } else {
      await connect();
      await startMic();
    }
  }, [isConnected, connect, disconnect, startMic, stopMic]);

  // Auto-start
  useEffect(() => {
    if (autoStart && !isConnected) {
      handleToggle();
    }
  }, [autoStart]);

  // Cleanup
  useEffect(
    () => () => {
      stopMic();
      disconnect();
    },
    [stopMic, disconnect],
  );

  // Parse transcript for display
  const lines = transcript.split('\n').filter(Boolean);
  const originalText =
    lines.find((l) => l.includes('[ORIGINAL]:'))?.replace(/\[ORIGINAL\]:\s*/, '') || '';
  const translatedText =
    lines
      .find((l) => l.includes(`[${targetLanguage.toUpperCase()}]:`))
      ?.replace(new RegExp(`\\[${targetLanguage.toUpperCase()}\\]:\\s*`), '') || '';

  return (
    <div
      className={`bg-slate-900/95 backdrop-blur-xl rounded-2xl border border-white/10 p-6 ${className}`}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div
            className={`w-10 h-10 rounded-xl flex items-center justify-center ${
              isConnected ? 'bg-gradient-to-br from-emerald-500 to-teal-600' : 'bg-slate-700'
            }`}
          >
            <Mic className="w-5 h-5 text-white" />
          </div>
          <div>
            <h3 className="text-white font-semibold">{SERVICE_ALIASES.ECHO.name}</h3>
            <p className="text-xs text-slate-500">{status}</p>
          </div>
        </div>

        {/* Speaking indicator */}
        {isSpeaking && (
          <div className="flex items-center gap-2 px-3 py-1 bg-purple-500/20 rounded-full">
            <Volume2 className="w-4 h-4 text-purple-400 animate-pulse" />
            <span className="text-xs text-purple-400">Speaking</span>
          </div>
        )}
      </div>

      {/* Transcript Display */}
      <div className="min-h-[150px] mb-6">
        {/* Original */}
        {originalText && (
          <div className="mb-4">
            <div className="flex items-center gap-2 mb-1">
              <Mic className="w-3 h-3 text-slate-500" />
              <span className="text-xs text-slate-500 uppercase">You said</span>
            </div>
            <p className="text-white/90 leading-relaxed">{originalText}</p>
          </div>
        )}

        {/* Translation */}
        {translatedText && (
          <div className="pt-4 border-t border-white/5">
            <div className="flex items-center gap-2 mb-1">
              <Volume2 className="w-3 h-3 text-emerald-400" />
              <span className="text-xs text-emerald-400 uppercase">{targetLanguage}</span>
            </div>
            <p className="text-xl text-emerald-400 font-medium leading-relaxed">{translatedText}</p>
          </div>
        )}

        {/* Placeholder */}
        {!transcript && !error && (
          <div className="flex flex-col items-center justify-center h-full text-center py-8">
            <div className="text-slate-500 text-sm">
              {isConnected ? 'Speak to translate...' : 'Click mic to start'}
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
            <p className="text-sm text-red-400">{error}</p>
          </div>
        )}
      </div>

      {/* Mic Button */}
      <div className="flex justify-center">
        <button
          onClick={handleToggle}
          className={`
            w-16 h-16 rounded-full flex items-center justify-center transition-all
            ${
              isConnected
                ? 'bg-gradient-to-br from-red-500 to-red-600 shadow-lg shadow-red-500/30'
                : 'bg-gradient-to-br from-emerald-500 to-teal-600 shadow-lg shadow-emerald-500/30'
            }
            hover:scale-105 active:scale-95
          `}
        >
          {isConnected ? (
            <MicOff className="w-7 h-7 text-white" />
          ) : (
            <Mic className="w-7 h-7 text-white" />
          )}
        </button>
      </div>

      {/* Language */}
      <div className="mt-4 text-center">
        <span className="text-xs text-slate-600">
          Translating to {targetLanguage} • v{SERVICE_ALIASES.ECHO.version}
        </span>
      </div>
    </div>
  );
}

export default EchoPanel;
