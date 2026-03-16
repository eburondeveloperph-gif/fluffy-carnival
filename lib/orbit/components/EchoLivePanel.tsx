import React, { useState, useCallback } from 'react';
import { useEchoLive } from '../hooks/useEchoLive';
import { Mic, MicOff, Volume2, VolumeX, Globe, Radio, Loader2 } from 'lucide-react';
import { SERVICE_ALIASES, STATUS_MESSAGES } from '../config/serviceAliases';

interface EchoLivePanelProps {
  apiKey?: string;
  targetLanguage?: string;
  onTranscript?: (text: string) => void;
  onTranslation?: (text: string) => void;
  className?: string;
}

/**
 * Simplified Echo Live Panel
 *
 * One-click start: Connects mic → Sends audio → Shows transcription → Plays translation
 *
 * No complex setup. Just:
 * 1. Click mic button to start
 * 2. Speak
 * 3. See transcription in real-time
 * 4. Hear translated audio automatically
 */
export const EchoLivePanel: React.FC<EchoLivePanelProps> = ({
  apiKey,
  targetLanguage = 'Spanish',
  onTranscript,
  onTranslation,
  className = '',
}) => {
  const [displayText, setDisplayText] = useState<string>('');
  const [transcript, setTranscript] = useState<string>('');
  const [translation, setTranslation] = useState<string>('');

  // Parse transcript to extract original and translation
  const parseTranscript = useCallback(
    (text: string) => {
      // Try to parse [ORIGINAL] and [LANGUAGE] format
      const originalMatch = text.match(/\[ORIGINAL\]:\s*(.+?)(?=\[|$)/i);
      const translatedMatch =
        text.match(new RegExp(`\\[${targetLanguage.toUpperCase()}\\]:\\s*(.+?)(?=\[|$)`, 'i')) ||
        text.match(/\[TRANSLATED\]:\s*(.+?)(?=\[|$)/i);

      if (originalMatch) {
        setTranscript(originalMatch[1].trim());
        onTranscript?.(originalMatch[1].trim());
      } else {
        setTranscript(text);
        onTranscript?.(text);
      }

      if (translatedMatch) {
        setTranslation(translatedMatch[1].trim());
        onTranslation?.(translatedMatch[1].trim());
      }

      setDisplayText(text);
    },
    [targetLanguage, onTranscript, onTranslation],
  );

  // Handle audio chunks (for visualization)
  const handleAudioChunk = useCallback((data: Uint8Array) => {
    // Could add audio visualization here
    console.log(`[Echo] Received ${data.length} bytes of audio`);
  }, []);

  const {
    isConnected,
    isListening,
    isSpeaking,
    error,
    status,
    connect,
    disconnect,
    startMicrophone,
    stopMicrophone,
  } = useEchoLive({
    apiKey: apiKey || process.env.NEXT_PUBLIC_GEMINI_API_KEY || '',
    targetLanguage,
    systemPrompt: `You are a real-time translator. 
      When you hear speech, transcribe it and translate to ${targetLanguage}.
      
      ALWAYS respond in this exact format:
      [ORIGINAL]: <exact transcription of what was said>
      [${targetLanguage.toUpperCase()}]: <natural translation to ${targetLanguage}>
      
      Speak the translation naturally as a native speaker would.`,
    onTranscript: parseTranscript,
    onAudioChunk: handleAudioChunk,
  });

  // Toggle mic
  const handleMicToggle = async () => {
    if (!isConnected) {
      await connect();
      // Auto-start mic after connecting
      setTimeout(() => startMicrophone(), 100);
    } else if (isListening) {
      stopMicrophone();
    } else {
      await startMicrophone();
    }
  };

  // Disconnect
  const handleDisconnect = () => {
    stopMicrophone();
    disconnect();
    setDisplayText('');
    setTranscript('');
    setTranslation('');
  };

  return (
    <div
      className={`bg-slate-900/95 backdrop-blur-xl rounded-2xl border border-white/10 overflow-hidden ${className}`}
    >
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-white/5">
        <div className="flex items-center gap-3">
          {/* Service Logo */}
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center">
            <Radio className="w-5 h-5 text-white" />
          </div>
          <div>
            <h3 className="text-white font-semibold">{SERVICE_ALIASES.ECHO.name}</h3>
            <p className="text-xs text-slate-400">{status || 'Ready'}</p>
          </div>
        </div>

        {/* Status Indicator */}
        <div className="flex items-center gap-2">
          {isSpeaking && (
            <div className="flex items-center gap-1 px-2 py-1 bg-purple-500/20 rounded-full">
              <Volume2 className="w-3 h-3 text-purple-400 animate-pulse" />
              <span className="text-xs text-purple-400">Speaking</span>
            </div>
          )}
          {isListening && (
            <div className="flex items-center gap-1 px-2 py-1 bg-emerald-500/20 rounded-full">
              <Radio className="w-3 h-3 text-emerald-400 animate-pulse" />
              <span className="text-xs text-emerald-400">Listening</span>
            </div>
          )}
        </div>
      </div>

      {/* Transcription Display */}
      <div className="p-6 min-h-[200px]">
        {/* Original Transcript */}
        {transcript && (
          <div className="mb-4">
            <div className="flex items-center gap-2 mb-2">
              <Mic className="w-4 h-4 text-slate-500" />
              <span className="text-xs text-slate-500 uppercase tracking-wider">You said</span>
            </div>
            <p className="text-lg text-white/90 leading-relaxed">{transcript}</p>
          </div>
        )}

        {/* Translation */}
        {translation && (
          <div className="mt-4 pt-4 border-t border-white/5">
            <div className="flex items-center gap-2 mb-2">
              <Globe className="w-4 h-4 text-emerald-500" />
              <span className="text-xs text-emerald-500 uppercase tracking-wider">
                {targetLanguage}
              </span>
            </div>
            <p className="text-xl text-emerald-400 font-medium leading-relaxed">{translation}</p>
          </div>
        )}

        {/* Placeholder */}
        {!transcript && !translation && !error && (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div
              className={`w-16 h-16 rounded-full flex items-center justify-center mb-4 ${
                isConnected ? 'bg-gradient-to-br from-emerald-500 to-teal-600' : 'bg-slate-700'
              }`}
            >
              <Mic className="w-8 h-8 text-white" />
            </div>
            <p className="text-slate-400 text-sm">
              {isConnected
                ? 'Click the mic and start speaking'
                : 'Click to start real-time translation'}
            </p>
          </div>
        )}

        {/* Error Display */}
        {error && (
          <div className="mt-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
            <p className="text-sm text-red-400">{error}</p>
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="flex items-center justify-center gap-4 p-4 border-t border-white/5">
        {/* Mic Button */}
        <button
          onClick={handleMicToggle}
          disabled={!isConnected && !apiKey && !process.env.NEXT_PUBLIC_GEMINI_API_KEY}
          className={`
            w-14 h-14 rounded-full flex items-center justify-center transition-all
            ${
              isListening
                ? 'bg-gradient-to-br from-red-500 to-red-600 shadow-lg shadow-red-500/30'
                : isConnected
                  ? 'bg-gradient-to-br from-emerald-500 to-teal-600 shadow-lg shadow-emerald-500/30'
                  : 'bg-gradient-to-br from-blue-500 to-indigo-600 shadow-lg shadow-blue-500/30'
            }
            ${
              !isConnected && !apiKey && !process.env.NEXT_PUBLIC_GEMINI_API_KEY
                ? 'opacity-50 cursor-not-allowed'
                : 'hover:scale-105 active:scale-95'
            }
          `}
        >
          {isListening ? (
            <MicOff className="w-6 h-6 text-white" />
          ) : (
            <Mic className="w-6 h-6 text-white" />
          )}
        </button>

        {/* Disconnect Button */}
        {isConnected && (
          <button
            onClick={handleDisconnect}
            className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white text-sm rounded-lg transition-colors"
          >
            Disconnect
          </button>
        )}
      </div>

      {/* Language Indicator */}
      <div className="flex items-center justify-center gap-2 px-4 pb-4">
        <Globe className="w-4 h-4 text-slate-500" />
        <span className="text-xs text-slate-500">Translating to {targetLanguage}</span>
      </div>
    </div>
  );
};

export default EchoLivePanel;
