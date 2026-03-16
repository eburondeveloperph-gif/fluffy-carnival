import React from 'react';
import {
  useHighAccuracyTranscription,
  TranscriptionSegment,
  TranscriptionStats,
} from '../hooks/useHighAccuracyTranscription';
import {
  Mic,
  Settings,
  RefreshCw,
  CheckCircle,
  AlertTriangle,
  Activity,
  BarChart3,
} from 'lucide-react';

interface HighAccuracyTranscriptionPanelProps {
  stream: MediaStream | null;
  isActive: boolean;
  targetLanguage?: string;
  onTranscript: (segment: TranscriptionSegment) => void;
  className?: string;
}

/**
 * High-Accuracy Transcription Panel
 *
 * Features:
 * - Real-time confidence scoring
 * - Audio preprocessing visualization
 * - Low-confidence segment retry
 * - Transcription statistics
 * - Noise gate adjustment
 * - Context-aware correction
 */
export const HighAccuracyTranscriptionPanel: React.FC<HighAccuracyTranscriptionPanelProps> = ({
  stream,
  isActive,
  targetLanguage = 'English',
  onTranscript,
  className = '',
}) => {
  const [showSettings, setShowSettings] = React.useState(false);
  const [noiseGateValue, setNoiseGateValue] = React.useState(0.02);
  const [confidenceThreshold, setConfidenceThreshold] = React.useState(0.85);

  const {
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
  } = useHighAccuracyTranscription({
    targetLanguage,
    enablePreprocessing: true,
    enableContextBoost: true,
    minConfidenceThreshold: confidenceThreshold,
    retryLowConfidence: true,
    maxRetries: 2,
    noiseGateThreshold: noiseGateValue,
  });

  // Start/stop based on isActive prop
  React.useEffect(() => {
    if (isActive && stream && !isTranscribing) {
      start(stream);
    } else if (!isActive && isTranscribing) {
      stop();
    }
  }, [isActive, stream, isTranscribing, start, stop]);

  // Notify parent of new segments
  React.useEffect(() => {
    if (currentSegment && isHighConfidence) {
      onTranscript(currentSegment);
    }
  }, [currentSegment, isHighConfidence, onTranscript]);

  const handleNoiseGateChange = (value: number) => {
    setNoiseGateValue(value);
    setNoiseGate(value);
  };

  const handleConfidenceChange = (value: number) => {
    setConfidenceThreshold(value);
    setMinConfidence(value);
  };

  // Get confidence color
  const getConfidenceColor = (conf: number) => {
    if (conf >= 0.9) return 'text-green-400';
    if (conf >= 0.75) return 'text-yellow-400';
    return 'text-red-400';
  };

  return (
    <div
      className={`bg-slate-900/90 backdrop-blur-xl rounded-xl border border-white/10 overflow-hidden ${className}`}
    >
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-white/5">
        <div className="flex items-center gap-3">
          <div
            className={`relative w-10 h-10 rounded-full flex items-center justify-center ${
              isTranscribing ? 'bg-gradient-to-br from-green-500 to-emerald-600' : 'bg-slate-700'
            }`}
          >
            <Mic className="w-5 h-5 text-white" />
            {isTranscribing && (
              <div className="absolute inset-0 rounded-full border-2 border-green-400 animate-pulse" />
            )}
          </div>
          <div>
            <h3 className="text-white font-semibold text-sm">High-Accuracy STT</h3>
            <div className="flex items-center gap-2">
              <span className={`text-xs ${getConfidenceColor(confidence)}`}>
                {(confidence * 100).toFixed(0)}% confidence
              </span>
              {preprocessingEnabled && (
                <span className="text-xs text-blue-400">• Preprocessing On</span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {stats.lowConfidenceSegments > 0 && (
            <button
              onClick={retryLastSegment}
              className="flex items-center gap-1 px-2 py-1 bg-yellow-500/20 text-yellow-400 rounded text-xs hover:bg-yellow-500/30 transition-colors"
            >
              <RefreshCw className="w-3 h-3" />
              Retry ({stats.lowConfidenceSegments})
            </button>
          )}
          <button
            onClick={() => setShowSettings(!showSettings)}
            className="p-2 text-slate-400 hover:text-white transition-colors"
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Current Transcription */}
      <div className="p-4 min-h-[100px]">
        {currentSegment ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              {isHighConfidence ? (
                <CheckCircle className="w-4 h-4 text-green-400" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-yellow-400" />
              )}
              <span className={`text-xs ${getConfidenceColor(currentSegment.confidence)}`}>
                {(currentSegment.confidence * 100).toFixed(0)}% • {currentSegment.wordCount} words
              </span>
            </div>
            <p className="text-white text-lg leading-relaxed">{currentSegment.text}</p>

            {!isHighConfidence && (
              <div className="flex items-center gap-2 p-2 bg-yellow-500/10 rounded-lg border border-yellow-500/20">
                <AlertTriangle className="w-4 h-4 text-yellow-400 flex-shrink-0" />
                <span className="text-xs text-yellow-400">
                  Low confidence segment. Click retry to improve accuracy.
                </span>
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-slate-500 text-sm">
            {isTranscribing ? (
              <div className="flex items-center gap-2">
                <Activity className="w-4 h-4 animate-pulse" />
                Listening...
              </div>
            ) : (
              'Ready to transcribe'
            )}
          </div>
        )}
      </div>

      {/* Settings Panel */}
      {showSettings && (
        <div className="border-t border-white/5 p-4 space-y-4">
          <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
            Settings
          </h4>

          {/* Noise Gate */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs text-slate-400">Noise Gate Threshold</label>
              <span className="text-xs text-slate-300">{(noiseGateValue * 100).toFixed(0)}%</span>
            </div>
            <input
              type="range"
              min="0"
              max="0.1"
              step="0.01"
              value={noiseGateValue}
              onChange={(e) => handleNoiseGateChange(parseFloat(e.target.value))}
              className="w-full h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer"
            />
            <p className="text-xs text-slate-500">Filter out background noise below this level</p>
          </div>

          {/* Confidence Threshold */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs text-slate-400">Min Confidence Threshold</label>
              <span className="text-xs text-slate-300">
                {(confidenceThreshold * 100).toFixed(0)}%
              </span>
            </div>
            <input
              type="range"
              min="0.5"
              max="0.95"
              step="0.05"
              value={confidenceThreshold}
              onChange={(e) => handleConfidenceChange(parseFloat(e.target.value))}
              className="w-full h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer"
            />
            <p className="text-xs text-slate-500">Segments below this will be retried</p>
          </div>

          {/* Preprocessing Toggle */}
          <div className="flex items-center justify-between p-2 bg-slate-800/50 rounded-lg">
            <span className="text-xs text-slate-300">Audio Preprocessing</span>
            <span
              className={`text-xs ${preprocessingEnabled ? 'text-green-400' : 'text-slate-500'}`}
            >
              {preprocessingEnabled ? 'Enabled' : 'Disabled'}
            </span>
          </div>
        </div>
      )}

      {/* Statistics */}
      <div className="border-t border-white/5 p-4 bg-slate-800/30">
        <div className="flex items-center gap-2 mb-3">
          <BarChart3 className="w-4 h-4 text-slate-400" />
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
            Statistics
          </span>
        </div>

        <div className="grid grid-cols-4 gap-4">
          <div className="text-center">
            <div className="text-lg font-semibold text-white">{stats.totalSegments}</div>
            <div className="text-xs text-slate-500">Segments</div>
          </div>
          <div className="text-center">
            <div className={`text-lg font-semibold ${getConfidenceColor(stats.averageConfidence)}`}>
              {(stats.averageConfidence * 100).toFixed(0)}%
            </div>
            <div className="text-xs text-slate-500">Avg Confidence</div>
          </div>
          <div className="text-center">
            <div className="text-lg font-semibold text-white">{stats.lowConfidenceSegments}</div>
            <div className="text-xs text-slate-500">Low Conf.</div>
          </div>
          <div className="text-center">
            <div className="text-lg font-semibold text-white">
              {stats.wordsPerMinute.toFixed(0)}
            </div>
            <div className="text-xs text-slate-500">WPM</div>
          </div>
        </div>
      </div>

      {/* Recent Segments */}
      {segments.length > 0 && (
        <div className="border-t border-white/5 p-4">
          <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
            Recent
          </h4>
          <div className="space-y-2 max-h-32 overflow-y-auto">
            {segments
              .slice(-5)
              .reverse()
              .map((segment) => (
                <div
                  key={segment.id}
                  className={`flex items-start gap-2 p-2 rounded text-sm ${
                    segment.confidence >= confidenceThreshold
                      ? 'bg-slate-800/30'
                      : 'bg-yellow-500/10 border border-yellow-500/20'
                  }`}
                >
                  {segment.confidence >= confidenceThreshold ? (
                    <CheckCircle className="w-3 h-3 text-green-400 mt-0.5 flex-shrink-0" />
                  ) : (
                    <AlertTriangle className="w-3 h-3 text-yellow-400 mt-0.5 flex-shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-slate-300 truncate">{segment.text}</p>
                    <p className={`text-xs ${getConfidenceColor(segment.confidence)}`}>
                      {(segment.confidence * 100).toFixed(0)}% • {segment.wordCount} words
                    </p>
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default HighAccuracyTranscriptionPanel;
