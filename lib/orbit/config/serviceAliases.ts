/**
 * Eburon AI Service Aliases
 *
 * This module provides abstraction over underlying AI services,
 * exposing only branded aliases in the frontend and logs.
 *
 * Aliases:
 * - "Eburon AI" → Translation LLM
 * - "Echo TTS" → Text-to-Speech
 * - "Echo STT" → Speech-to-Text (GeminiLive)
 *
 * Never expose internal model names in:
 * - Frontend UI
 * - Error logs
 * - Client-side code
 * - Debug messages
 */

// ============================================
// INTERNAL CONFIGURATION (Server-side only)
// ============================================

// Single model for everything: STT + Translation + TTS
const ECHO_MODEL = 'gemini-2.0-flash';

// Whitelist (single model does it all)
const WHITELISTED_MODELS: Record<string, readonly string[]> = {
  ECHO_LIVE: [ECHO_MODEL],
  STT_LIVE_AUDIO: [ECHO_MODEL],
  TRANSLATION_LLM: [ECHO_MODEL],
  TTS: [ECHO_MODEL],
} as const;

// Provider whitelist
const WHITELISTED_PROVIDERS: Record<string, readonly string[]> = {
  STT: ['gemini-live'],
  TRANSLATION: ['google-translate', 'gemini', 'deepseek', 'ollama'],
  TTS: ['cartesia', 'ollama'],
} as const;

// ============================================
// PUBLIC ALIASES (Exposed to frontend)
// ============================================

export const SERVICE_ALIASES = {
  // Echo - Single model for STT + Translation + TTS
  ECHO: {
    name: 'Echo',
    displayName: 'Echo',
    version: '2.5',
    description: 'Real-time speech translation',
    model: 'gemini-2.5-flash-native-audio-preview-12-2025', // Hidden from frontend
  },
} as const;

export type ServiceAlias = keyof typeof SERVICE_ALIASES;

// ============================================
// ERROR SANITIZATION
// ============================================

/**
 * Sanitize error messages to remove internal details
 */
export function sanitizeErrorMessage(error: unknown): string {
  if (!error) return 'An unexpected error occurred';

  const originalMessage = error instanceof Error ? error.message : String(error);

  // Replace all internal model/provider names with aliases
  const sanitized = originalMessage
    // Model names
    .replace(/gemini[-\d\.]*\w*/gi, 'Echo')
    .replace(/deepseek[-\w]*/gi, 'Eburon')
    .replace(/sonic[-\d\w]*/gi, 'Echo Voice')
    .replace(/nova[-\d]*/gi, 'Echo')
    .replace(/whisper[-\w]*/gi, 'Echo')
    // Provider names
    .replace(/google\s*genai/gi, 'Eburon')
    .replace(/cartesia/gi, 'Echo Voice')
    .replace(/deepgram/gi, 'Echo')
    .replace(/ollama/gi, 'Eburon Local')
    .replace(/openai/gi, 'Eburon')
    .replace(/anthropic/gi, 'Eburon')
    // Technical details
    .replace(/api[_-]?key/gi, 'credentials')
    .replace(/[a-zA-Z0-9_-]{32,}/gi, '[redacted]')
    .replace(/https?:\/\/[^\s]+/gi, '[endpoint]')
    // Error types
    .replace(/ECONNREFUSED/gi, 'connection failed')
    .replace(/ETIMEDOUT/gi, 'request timed out')
    .replace(/401|403/gi, 'authentication failed')
    .replace(/429/gi, 'rate limit reached')
    .replace(/50[0-9]/gi, 'service temporarily unavailable');

  // If message is too technical, return generic
  if (sanitized.includes('{') || sanitized.includes('[') || sanitized.length > 200) {
    return 'Echo service temporarily unavailable. Please try again.';
  }

  return sanitized;
}

// ============================================
// LOG HELPERS
// ============================================

/**
 * Create a sanitized log prefix for the specified service
 */
export function getLogPrefix(service: ServiceAlias): string {
  return `[${SERVICE_ALIASES[service].displayName}]`;
}

/**
 * Log message with alias (never expose internal details)
 */
export function logInfo(service: ServiceAlias, message: string): void {
  console.log(`${getLogPrefix(service)} ${message}`);
}

/**
 * Logerror with sanitized message
 */
export function logError(service: ServiceAlias, error: unknown): void {
  console.error(`${getLogPrefix(service)} ${sanitizeErrorMessage(error)}`);
}

/**
 * Log warning with sanitized message
 */
export function logWarn(service: ServiceAlias, message: string): void {
  console.warn(`${getLogPrefix(service)} ${message}`);
}

// ============================================
// MODEL RESOLUTION (Server-side only)
// ============================================

/**
 * Get the actual model ID for the service
 * Should only be called from server-side code
 */
export function getModelId(
  service: 'STT_LIVE_AUDIO' | 'TRANSLATION_LLM' | 'TTS',
  preferredModel?: string,
): string {
  const whitelist = WHITELISTED_MODELS[service];

  if (preferredModel && whitelist.includes(preferredModel as any)) {
    return preferredModel;
  }

  // Return first whitelisted model
  return whitelist[0];
}

/**
 * Check if a model is whitelisted
 */
export function isModelWhitelisted(
  service: 'STT_LIVE_AUDIO' | 'TRANSLATION_LLM' | 'TTS',
  modelId: string,
): boolean {
  return WHITELISTED_MODELS[service].includes(modelId as any);
}

/**
 * Check if a provider is whitelisted
 */
export function isProviderWhitelisted(
  service: 'STT' | 'TRANSLATION' | 'TTS',
  providerId: string,
): boolean {
  return WHITELISTED_PROVIDERS[service].includes(providerId as any);
}

// ============================================
// USER-FACING STATUS MESSAGES
// ============================================

export const STATUS_MESSAGES = {
  INITIALIZING: 'Echo initializing...',
  LISTENING: 'Listening...',
  PROCESSING: 'Processing...',
  SPEAKING: 'Speaking...',
  SYNTHESIZING: 'Synthesizing...',
  PLAYING: 'Playing...',
  ERROR: 'Connection failed. Retrying...',
  CONNECTION_READY: 'Connected.',
  CONNECTION_LOST: 'Connection lost. Reconnecting...',
  CONNECTION_ERROR: 'Connection failed.',
  COMPLETE: 'Complete.',
} as const;

// ============================================
// FRONTEND HELPER FUNCTIONS
// ============================================

/**
 * Get user-friendly service name
 */
export function getServiceName(service: ServiceAlias): string {
  return SERVICE_ALIASES[service].name;
}

/**
 * Get user-friendly service display name
 */
export function getServiceDisplayName(service: ServiceAlias): string {
  return SERVICE_ALIASES[service].displayName;
}

/**
 * Get service description
 */
export function getServiceDescription(service: ServiceAlias): string {
  return SERVICE_ALIASES[service].description;
}
