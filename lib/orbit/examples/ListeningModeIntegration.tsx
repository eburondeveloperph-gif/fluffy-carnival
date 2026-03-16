import React, { useState, useCallback, useRef } from 'react';
import { RealtimeTranslationListener } from '../components/RealtimeTranslationListener';
import { useRealtimeTranslation } from '../hooks/useRealtimeTranslation';
import { Headphones, Volume2, VolumeX } from 'lucide-react';

/**
 * Example: Integrating Real-time Translation into the Listening Mode
 *
 * This shows how to use the transcription → translation → TTS pipeline
 * when a user clicks the orbit icon to enter listening mode.
 */

interface ListeningModeDemoProps {
  meetingId: string | null;
  myUserId: string;
  targetLanguage: string;
}

/**
 * Option 1: Using the RealtimeTranslationListener Component
 * Drop-in component that handles everything
 */
export const ListeningModeWithComponent: React.FC<ListeningModeDemoProps> = ({
  meetingId,
  myUserId,
  targetLanguage,
}) => {
  const [isListening, setIsListening] = useState(false);

  return (
    <div className="p-4">
      {/* Toggle Listening Mode */}
      <button
        onClick={() => setIsListening(!isListening)}
        className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all ${
          isListening ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
        }`}
      >
        {isListening ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
        {isListening ? 'Stop Listening' : 'Start Listening'}
      </button>

      {/* Real-time Translation Panel */}
      {isListening && (
        <div className="mt-4">
          <RealtimeTranslationListener
            meetingId={meetingId}
            myUserId={myUserId}
            targetLanguage={targetLanguage}
            isListening={isListening}
          />
        </div>
      )}
    </div>
  );
};

/**
 * Option 2: Using the Hook Directly (More Control)
 * Use this when you need custom UI or additional logic
 */
export const ListeningModeWithHook: React.FC<ListeningModeDemoProps> = ({
  meetingId,
  myUserId,
  targetLanguage,
}) => {
  const [isListening, setIsListening] = useState(false);
  const audioContextRef = useRef<AudioContext | null>(null);

  // Use the hook for real-time translation
  const { items, currentText, isProcessing, isPlaying, queueLength } = useRealtimeTranslation({
    meetingId,
    myUserId,
    targetLanguage,
    enabled: isListening,
  });

  // Initialize audio context on user interaction
  const startListening = useCallback(async () => {
    // Initialize AudioContext (required for TTS playback)
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    if (audioContextRef.current.state === 'suspended') {
      await audioContextRef.current.resume();
    }

    setIsListening(true);

    // Optional: Mute other audio sources
    document.querySelectorAll('audio, video').forEach((el: any) => {
      if (!el.muted) {
        el.muted = true;
        el.dataset.orbitAutoMuted = 'true';
      }
    });
  }, []);

  const stopListening = useCallback(() => {
    setIsListening(false);

    // Unmute other audio sources
    document.querySelectorAll('audio, video').forEach((el: any) => {
      if (el.dataset.orbitAutoMuted === 'true') {
        el.muted = false;
        delete el.dataset.orbitAutoMuted;
      }
    });
  }, []);

  return (
    <div className="p-4 space-y-4">
      {/* Control Button */}
      <button
        onClick={isListening ? stopListening : startListening}
        className={`flex items-center gap-2 px-6 py-3 rounded-full font-semibold transition-all ${
          isListening
            ? 'bg-red-500 hover:bg-red-600 text-white shadow-lg shadow-red-500/30'
            : 'bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 text-white shadow-lg shadow-blue-500/30'
        }`}
      >
        <Headphones className="w-5 h-5" />
        {isListening ? 'Stop Listening' : 'Start Listening'}
      </button>

      {/* Status Indicators */}
      {isListening && (
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-slate-800/50 rounded-lg p-3">
            <p className="text-xs text-slate-500 mb-1">Status</p>
            <div className="flex items-center gap-2">
              <div
                className={`w-2 h-2 rounded-full ${isPlaying ? 'bg-green-500 animate-pulse' : isProcessing ? 'bg-yellow-500 animate-pulse' : 'bg-blue-500'}`}
              />
              <span className="text-sm text-white">
                {isPlaying ? 'Speaking' : isProcessing ? 'Processing' : 'Waiting'}
              </span>
            </div>
          </div>

          <div className="bg-slate-800/50 rounded-lg p-3">
            <p className="text-xs text-slate-500 mb-1">Queue</p>
            <p className="text-sm text-white">{queueLength} pending</p>
          </div>
        </div>
      )}

      {/* Current Translation */}
      {currentText && (
        <div className="bg-slate-800/80 backdrop-blur rounded-xl p-4 border border-white/10">
          <div className="flex items-center gap-2 mb-2">
            {isPlaying && <Volume2 className="w-4 h-4 text-green-400 animate-pulse" />}
            <span className="text-xs text-slate-400 uppercase tracking-wider">
              Current Translation
            </span>
          </div>
          <p className="text-xl text-white font-medium">{currentText}</p>
        </div>
      )}

      {/* History */}
      {items.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs text-slate-500 uppercase tracking-wider">History</p>
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {items.slice(-10).map((item) => (
              <div
                key={item.id}
                className={`p-3 rounded-lg text-sm ${
                  item.status === 'completed'
                    ? 'bg-slate-800/30 text-slate-300'
                    : 'bg-slate-800/50 text-white'
                }`}
              >
                <p className="text-slate-400 text-xs mb-1">Original: {item.originalText}</p>
                <p>{item.translatedText || 'Translating...'}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

/**
 * Integration Example for OrbitApp.tsx
 *
 * Add this to your listening mode UI in OrbitApp.tsx:
 *
 * ```tsx
 * // In the listening mode section of OrbitApp.tsx
 * {mode === 'listening' && (
 *   <RealtimeTranslationListener
 *     meetingId={meetingId}
 *     myUserId={MY_USER_ID}
 *     targetLanguage={selectedLanguage.name}
 *     isListening={true}
 *   />
 * )}
 * ```
 */

export default {
  ListeningModeWithComponent,
  ListeningModeWithHook,
};
