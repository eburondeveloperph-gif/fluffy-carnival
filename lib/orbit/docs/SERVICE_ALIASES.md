# Eburon AI Service Aliases

## Overview

All internal AI models and providers are whitelisted and aliased to user-friendly names. **Never expose internal model names in:**

- Frontend UI
- Error logs
- Client-side code
- Debug messages

## Service Aliases

| Alias         | Internal Provider | Whitelisted Models                              |
| ------------- | ----------------- | ----------------------------------------------- |
| **Echo STT**  | Gemini Live Audio | `gemini-2.5-flash-native-audio-preview-12-2025` |
| **Eburon AI** | Gemini / DeepSeek | `gemini-1.5-flash`, `deepseek-chat`             |
| **Echo TTS**  | Cartesia          | `sonic-3-latest`                                |

## Usage

### In Components

```typescript
import { ServiceStatus, ServiceLogo, SERVICE_ALIASES } from '@/lib/orbit/components/ServiceStatus';

// Show status indicator
<ServiceStatus
  isReady={isReady}
  isTranscribing={isTranscribing}
  isTranslating={isTranslating}
  isPlaying={isPlaying}
  error={error}
/>

// Show brandedlogo
<ServiceLogo service="STT" size="md" showName />

// Get display name
const name = SERVICE_ALIASES.STT.displayName; // "Echo STT"
```

### In Error Handling

```typescript
import { sanitizeErrorMessage, logError, STATUS_MESSAGES } from '@/lib/orbit/config/serviceAliases';

try {
  // ... service call
} catch (error) {
  // Log sanitized error (never shows model names)
  logError('STT', error);

  // Return sanitized message to frontend
  return NextResponse.json({
    error: STATUS_MESSAGES.STT_ERROR,
    message: sanitizeErrorMessage(error),
  });
}
```

### In Hooks

```typescript
import { getServiceName, logInfo, STATUS_MESSAGES } from '@/lib/orbit/config/serviceAliases';

// Log with alias
logInfo('STT', 'Listening for speech...');

// Get user-friendly name
const serviceName = getServiceName('TRANSLATION'); // "Eburon AI"

// Use status messages
setStatus(STATUS_MESSAGES.STT_LISTENING);
```

## File Structure

```
lib/orbit/config/serviceAliases.ts     # Alias definitions
lib/orbit/components/ServiceStatus.tsx # UI components
```

## Whitelist

Only whitelisted models can be used:

```typescript
const WHITELISTED_MODELS = {
  STT_LIVE_AUDIO: ['gemini-2.5-flash-native-audio-preview-12-2025'],
  TRANSLATION_LLM: ['gemini-1.5-flash', 'deepseek-chat'],
  TTS: ['sonic-3-latest'],
};
```

## Status Messages

All user-facing messages use aliases:

| Internal State       | User Message                            |
| -------------------- | --------------------------------------- |
| Connecting to Gemini | "Echo STT initializing..."              |
| Translating          | "Eburon AI translating..."              |
| Synthesizing TTS     | "Echo TTS synthesizing..."              |
| Connection error     | "Connection lost. Reconnecting..."      |
| API error            | "Echo service temporarily unavailable." |

## Error Sanitization

All errors are sanitized before reaching the client:

```typescript
// Before sanitization (internal)
'GEMINI_API_KEY is invalid for model gemini-2.5-flash...';

// After sanitization (client)
'Echo service temporarily unavailable. Please try again.';
```

## API Responses

All API responses use aliases:

```json
{
  "transcript": "Hello world",
  "confidence": 0.95,
  "engine": "Echo STT",
  "version": "2.5"
}
```

```json
{
  "translation": "Hola mundo",
  "engine": "Eburon AI",
  "version": "1.5"
}
```
