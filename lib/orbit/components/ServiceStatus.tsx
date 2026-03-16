import React from 'react';
import { Mic, Volume2, Activity, Loader2, CheckCircle2, AlertCircle, Radio } from 'lucide-react';
import { SERVICE_ALIASES, STATUS_MESSAGES } from '../config/serviceAliases';

interface ServiceStatusProps {
  isReady: boolean;
  isListening: boolean;
  isPlaying: boolean;
  error: string | null;
  className?: string;
}

/**
 * Service Status Indicator
 *
 * Shows user-friendly status for Echo
 * Never exposes internal model names
 */
export const ServiceStatus: React.FC<ServiceStatusProps> = ({
  isReady,
  isListening,
  isPlaying,
  error,
  className = '',
}) => {
  const getStatus = () => {
    if (error) return { label: STATUS_MESSAGES.ERROR, color: 'text-red-400', icon: AlertCircle };
    if (!isReady)
      return { label: STATUS_MESSAGES.CONNECTION_LOST, color: 'text-yellow-400', icon: Activity };
    if (isPlaying)
      return { label: STATUS_MESSAGES.SPEAKING, color: 'text-green-400', icon: Volume2 };
    if (isListening)
      return { label: STATUS_MESSAGES.LISTENING, color: 'text-emerald-400', icon: Radio };
    return { label: STATUS_MESSAGES.CONNECTION_READY, color: 'text-green-400', icon: CheckCircle2 };
  };

  const status = getStatus();
  const Icon = status.icon;

  return (
    <div
      className={`flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-800/50 border border-white/5 ${className}`}
    >
      <Icon
        className={`w-4 h-4 ${status.color} ${status.icon === Loader2 ? 'animate-spin' : ''}`}
      />
      <span className={`text-xs font-medium ${status.color}`}>{status.label}</span>
    </div>
  );
};

/**
 * Echo Logo Component
 */
export const EchoLogo: React.FC<{
  size?: 'sm' | 'md' | 'lg';
  showName?: boolean;
}> = ({ size = 'md', showName = false }) => {
  const sizeClasses = {
    sm: 'w-6 h-6',
    md: 'w-8 h-8',
    lg: 'w-12 h-12',
  };
  const textClasses = {
    sm: 'text-xs',
    md: 'text-sm',
    lg: 'text-base',
  };

  return (
    <div className="flex items-center gap-2">
      <div
        className={`${sizeClasses[size]} rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center`}
      >
        <Radio className="w-1/2 h-1/2 text-white" />
      </div>
      {showName && (
        <div className="flex flex-col">
          <span className={`${textClasses[size]} font-semibold text-white`}>
            {SERVICE_ALIASES.ECHO.name}
          </span>
          <span className="text-xs text-slate-500">v{SERVICE_ALIASES.ECHO.version}</span>
        </div>
      )}
    </div>
  );
};

/**
 * Echo Footer - Shows powered by branding
 */
export const EchoFooter: React.FC<{ className?: string }> = ({ className = '' }) => {
  return (
    <div className={`flex items-center justify-center gap-2 ${className}`}>
      <EchoLogo size="sm" />
      <span className="text-xs text-slate-500">
        {SERVICE_ALIASES.ECHO.displayName} v{SERVICE_ALIASES.ECHO.version}
      </span>
    </div>
  );
};

export default ServiceStatus;
