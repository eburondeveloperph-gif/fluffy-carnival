import React, { useState, useEffect, useCallback } from 'react';
import {
  useTwoWayTranslation,
  UserRole,
  TranslationMessage,
  RemoteUser,
} from '../hooks/useTwoWayTranslation';
import { Language } from '../types';
import {
  Mic,
  Headphones,
  Volume2,
  VolumeX,
  Globe,
  Users,
  Activity,
  Loader2,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';

interface TwoWayTranslationPanelProps {
  meetingId: string | null;
  myUserId: string;
  myUserName: string;
  myLanguage: Language;
  className?: string;
}

/**
 * Two-Way Translation Panel with Orbit Icon Integration
 *
 * This component provides the UI for bidirectional real-time translation:
 * - Click the orbit icon to toggle between speaking and listening
 * - When speaking: Your speech is transcribed and broadcast to all listeners
 * - When listening: You receive translations in your selected language with TTS
 *
 * Audio Separation:
 * - Input and output audio are completely isolated
 * - Prevents feedback loops
 * - Allows bidirectional communication without audio interference
 */
export const TwoWayTranslationPanel: React.FC<TwoWayTranslationPanelProps> = ({
  meetingId,
  myUserId,
  myUserName,
  myLanguage,
  className = '',
}) => {
  const [showDetails, setShowDetails] = useState(false);

  const {
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
  } = useTwoWayTranslation({
    meetingId,
    myUserId,
    myUserName,
    myLanguage,
  });

  // Count listeners and speakers
  const listenerCount = remoteUsers.filter((u) => u.role === 'listener').length;
  const speakerCount = remoteUsers.filter((u) => u.role === 'speaker').length;

  // Get status text
  const getStatusText = () => {
    if (!isReady) return 'Connecting...';
    if (error) return 'Error';
    if (myRole === 'speaker') {
      if (isTranscribing) return 'Transcribing...';
      return 'Speaking';
    }
    if (myRole === 'listener') {
      if (isTranslating) return 'Translating...';
      if (isPlaying) return 'Playing audio...';
      return 'Listening';
    }
    return 'Idle';
  };

  // Get status color
  const getStatusColor = () => {
    if (error) return 'text-red-400';
    if (!isReady) return 'text-yellow-400';
    if (myRole === 'speaker') return 'text-red-400';
    if (myRole === 'listener') return 'text-blue-400';
    return 'text-slate-400';
  };

  return (
    <div className={`flex flex-col items-center ${className}`}>
      {/* Main Orbit Icon Button */}
      <div className="relative">
        {/* Audio separation indicator ring */}
        {isAudioSeparated && (
          <div className="absolute inset-0 rounded-full border-2 border-green-500/30 animate-pulse" />
        )}

        {/* Connection status ring */}
        {isReady && (
          <div
            className={`absolute -inset-2 rounded-full border-2 ${
              myRole === 'speaker'
                ? 'border-red-500/50'
                : myRole === 'listener'
                  ? 'border-blue-500/50'
                  : 'border-slate-500/30'
            }`}
          />
        )}

        {/* Main Orbit Button */}
        <button
          onClick={toggleRole}
          disabled={!isReady}
          className={`
            relative w-20 h-20 rounded-full flex items-center justify-center
            transition-all duration-300 transform hover:scale-105 active:scale-95
            ${
              !isReady
                ? 'bg-slate-700 cursor-not-allowed'
                : myRole === 'speaker'
                  ? 'bg-gradient-to-br from-red-600 to-red-800 shadow-lg shadow-red-500/30'
                  : myRole === 'listener'
                    ? 'bg-gradient-to-br from-blue-600 to-blue-800 shadow-lg shadow-blue-500/30'
                    : 'bg-gradient-to-br from-slate-600 to-slate-800 hover:from-slate-500 hover:to-slate-700'
            }
          `}
        >
          {/* Icon based on role */}
          {myRole === 'speaker' ? (
            <Mic className="w-8 h-8 text-white" />
          ) : myRole === 'listener' ? (
            <Headphones className="w-8 h-8 text-white" />
          ) : (
            <Globe className="w-8 h-8 text-white" />
          )}

          {/* Activity indicator */}
          {(isTranscribing || isTranslating || isPlaying) && (
            <div className="absolute -top-1 -right-1">
              <Activity className="w-5 h-5 text-white animate-pulse" />
            </div>
          )}
        </button>

        {/* Status badge */}
        <div
          className={`
          absolute -bottom-1 left-1/2 transform -translate-x-1/2
          px-2 py-0.5 rounded-full text-[10px] font-medium whitespace-nowrap
          ${
            myRole === 'speaker'
              ? 'bg-red-500 text-white'
              : myRole === 'listener'
                ? 'bg-blue-500 text-white'
                : 'bg-slate-600 text-slate-200'
          }
        `}
        >
          {getStatusText()}
        </div>
      </div>

      {/* Info Panel */}
      <div className="mt-6 w-full max-w-sm bg-slate-900/90 backdrop-blur-xl rounded-xl border border-white/10 p-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Globe className="w-4 h-4 text-slate-400" />
            <span className="text-sm text-slate-300">{myLanguage.name}</span>
          </div>
          <button
            onClick={() => setShowDetails(!showDetails)}
            className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
          >
            {showDetails ? 'Hide' : 'Details'}
          </button>
        </div>

        {/* Current Activity */}
        {currentMessage && (
          <div className="mb-4 p-3 bg-slate-800/50 rounded-lg">
            <div className="flex items-center gap-2 mb-2">
              {currentMessage.speakerId === myUserId ? (
                <Mic className="w-3 h-3 text-red-400" />
              ) : (
                <Users className="w-3 h-3 text-blue-400" />
              )}
              <span className="text-xs text-slate-400">
                {currentMessage.speakerId === myUserId ? 'You' : currentMessage.speakerName}
              </span>
            </div>
            <p className="text-sm text-white mb-1">{currentMessage.originalText}</p>
            {currentMessage.translations.get(myLanguage.name) && (
              <p className="text-sm text-emerald-400">
                → {currentMessage.translations.get(myLanguage.name)}
              </p>
            )}
            <div className="flex items-center gap-2 mt-2">
              {currentMessage.status === 'transcribing' && (
                <>
                  <Loader2 className="w-3 h-3 text-yellow-400 animate-spin" />
                  <span className="text-xs text-yellow-400">Transcribing</span>
                </>
              )}
              {currentMessage.status === 'translating' && (
                <>
                  <Loader2 className="w-3 h-3 text-blue-400 animate-spin" />
                  <span className="text-xs text-blue-400">Translating</span>
                </>
              )}
              {currentMessage.status === 'synthesizing' && (
                <>
                  <Loader2 className="w-3 h-3 text-purple-400 animate-spin" />
                  <span className="text-xs text-purple-400">Synthesizing</span>
                </>
              )}
              {currentMessage.status === 'ready' && (
                <>
                  <CheckCircle2 className="w-3 h-3 text-green-400" />
                  <span className="text-xs text-green-400">Ready</span>
                </>
              )}
            </div>
          </div>
        )}

        {/* Status indicators */}
        <div className="grid grid-cols-2 gap-2 mb-4">
          <div
            className={`flex items-center gap-2 p-2 rounded-lg ${
              isAudioSeparated ? 'bg-green-500/10' : 'bg-slate-800/50'
            }`}
          >
            {isAudioSeparated ? (
              <CheckCircle2 className="w-3 h-3 text-green-400" />
            ) : (
              <Loader2 className="w-3 h-3 text-yellow-400 animate-spin" />
            )}
            <span className={`text-xs ${isAudioSeparated ? 'text-green-400' : 'text-yellow-400'}`}>
              Audio Separated
            </span>
          </div>

          <div
            className={`flex items-center gap-2 p-2 rounded-lg ${
              isReady ? 'bg-green-500/10' : 'bg-slate-800/50'
            }`}
          >
            {isReady ? (
              <CheckCircle2 className="w-3 h-3 text-green-400" />
            ) : (
              <Loader2 className="w-3 h-3 text-yellow-400 animate-spin" />
            )}
            <span className={`text-xs ${isReady ? 'text-green-400' : 'text-yellow-400'}`}>
              Connected
            </span>
          </div>
        </div>

        {/* Remote Users */}
        {showDetails && (
          <div className="border-t border-white/5 pt-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-slate-500">Participants</span>
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500">{listenerCount} listening</span>
                <span className="text-xs text-slate-500">{speakerCount} speaking</span>
              </div>
            </div>

            <div className="space-y-1 max-h-32 overflow-y-auto">
              {remoteUsers.map((user) => (
                <div
                  key={user.userId}
                  className="flex items-center justify-between p-2 bg-slate-800/30 rounded"
                >
                  <div className="flex items-center gap-2">
                    {user.role === 'speaker' ? (
                      <Mic className="w-3 h-3 text-red-400" />
                    ) : (
                      <Headphones className="w-3 h-3 text-blue-400" />
                    )}
                    <span className="text-xs text-slate-300">{user.userName}</span>
                  </div>
                  <span className="text-xs text-slate-500">{user.selectedLanguage.name}</span>
                </div>
              ))}

              {remoteUsers.length === 0 && (
                <div className="text-center py-2 text-xs text-slate-600">No other participants</div>
              )}
            </div>
          </div>
        )}

        {/* Error Display */}
        {error && (
          <div className="mt-3 p-2 bg-red-500/10 border border-red-500/30 rounded-lg flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-red-400" />
            <span className="text-xs text-red-400">{error}</span>
          </div>
        )}

        {/* Quick Stats */}
        {messages.length > 0 && (
          <div className="mt-3 pt-3 border-t border-white/5 flex items-center justify-between text-xs text-slate-500">
            <span>{messages.length} messages</span>
            <span>
              {myLanguage.flag} {myLanguage.name}
            </span>
          </div>
        )}
      </div>

      {/* Instructions */}
      <div className="mt-4 text-center">
        <p className="text-xs text-slate-500">
          {myRole === 'idle' && 'Click the orbit icon to start'}
          {myRole === 'speaker' && 'Speaking in ' + myLanguage.name}
          {myRole === 'listener' && 'Listening for translations in ' + myLanguage.name}
        </p>
      </div>
    </div>
  );
};

export default TwoWayTranslationPanel;
