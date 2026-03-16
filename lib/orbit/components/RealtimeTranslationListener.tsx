import React from 'react';
import { useRealtimeTranslation } from '../hooks/useRealtimeTranslation';
import { Globe, Volume2, Loader2, Activity } from 'lucide-react';

interface RealtimeTranslationListenerProps {
  meetingId: string | null;
  myUserId: string;
  targetLanguage: string;
  isListening: boolean;
}

/**
 * Real-time Translation Listener Component
 *
 * This component demonstrates how to use the useRealtimeTranslation hook
 * to receive transcribed text from speakers, translate it, and play TTS
 * for the listening user.
 *
 * Usage:
 * - Place this component in the listening mode UI
 * - It will automatically receive transcriptions via WebSocket
 * - Translate and synthesize speech in real-time
 */
export const RealtimeTranslationListener: React.FC<RealtimeTranslationListenerProps> = ({
  meetingId,
  myUserId,
  targetLanguage,
  isListening,
}) => {
  const { items, currentText, isProcessing, isPlaying, queueLength } = useRealtimeTranslation({
    meetingId,
    myUserId,
    targetLanguage,
    enabled: isListening,
  });

  // Get recent items (last 5)
  const recentItems = items.slice(-5);

  return (
    <div className="bg-slate-900/90 backdrop-blur-xl border border-white/10 rounded-xl p-4 w-full max-w-md">
      {/* Header with Orbit Icon */}
      <div className="flex items-center gap-3 mb-4">
        <div className="relative">
          {/* Orbit Icon - Animated when active */}
          <div
            className={`w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center ${isProcessing ? 'animate-pulse' : ''}`}
          >
            <Globe className="w-5 h-5 text-white" />
          </div>
          {/* Status indicator */}
          {isListening && (
            <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-green-500 rounded-full border-2 border-slate-900 animate-pulse" />
          )}
        </div>
        <div>
          <h3 className="text-white font-semibold text-sm">Orbit Translator</h3>
          <p className="text-slate-400 text-xs">
            {isListening ? 'Listening for speakers...' : 'Paused'}
          </p>
        </div>
      </div>

      {/* Current Translation Display */}
      <div className="bg-slate-800/50 rounded-lg p-4 mb-4 min-h-[80px]">
        {currentText ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              {isProcessing && !isPlaying && (
                <Loader2 className="w-4 h-4 text-blue-400 animate-spin" />
              )}
              {isPlaying && <Volume2 className="w-4 h-4 text-green-400 animate-pulse" />}
              <span className="text-xs text-slate-500 uppercase tracking-wider">
                {isPlaying ? 'Speaking' : isProcessing ? 'Translating' : 'Translated'}
              </span>
            </div>
            <p className="text-white text-lg font-medium leading-relaxed">{currentText}</p>
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-slate-500 text-sm">
            <Activity className="w-4 h-4 mr-2" />
            Waiting for speaker...
          </div>
        )}
      </div>

      {/* Queue Status */}
      {queueLength > 0 && (
        <div className="flex items-center gap-2 text-xs text-slate-400 mb-3">
          <div className="flex-1 bg-slate-800 rounded-full h-1.5 overflow-hidden">
            <div
              className="bg-blue-500 h-full transition-all duration-300"
              style={{
                width: `${Math.min((items.filter((i) => i.status === 'completed').length / items.length) * 100, 100)}%`,
              }}
            />
          </div>
          <span>{queueLength} pending</span>
        </div>
      )}

      {/* Recent Translations Log */}
      {recentItems.length > 0 && (
        <div className="space-y-2 max-h-32 overflow-y-auto">
          <p className="text-xs text-slate-500 uppercase tracking-wider">Recent</p>
          {recentItems.map((item) => (
            <div
              key={item.id}
              className={`text-sm p-2 rounded transition-all ${
                item.status === 'completed'
                  ? 'bg-slate-800/30 text-slate-300'
                  : item.status === 'playing'
                    ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                    : 'bg-slate-800/50 text-slate-400'
              }`}
            >
              <div className="flex items-center gap-2">
                {item.status === 'completed' && <span className="text-green-500">✓</span>}
                {item.status === 'playing' && (
                  <Volume2 className="w-3 h-3 text-blue-400 animate-pulse" />
                )}
                {item.status === 'translating' && <Loader2 className="w-3 h-3 animate-spin" />}
                <span className="truncate">{item.originalText}</span>
              </div>
              {item.translatedText && (
                <p className="text-xs text-slate-500 mt-1 pl-5">→ {item.translatedText}</p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Language Indicator */}
      <div className="mt-4 pt-3 border-t border-white/5 flex items-center justify-between text-xs text-slate-500">
        <span>Target: {targetLanguage}</span>
        <span className="flex items-center gap-1">
          <div
            className={`w-2 h-2 rounded-full ${isListening ? 'bg-green-500' : 'bg-slate-600'}`}
          />
          {isListening ? 'Active' : 'Inactive'}
        </span>
      </div>
    </div>
  );
};

export default RealtimeTranslationListener;
