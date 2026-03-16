# Two-Way Real-Time Translation System

## Overview

This system provides **bidirectional real-time translation** with:

- **High-accuracy transcription** using Gemini Live Audio
- **WebSocket communication** for instant broadcast to all users
- **Per-user translation** to each listener's selected language
- **Per-user TTS** synthesized for each target language
- **Robust audio separation** preventing feedback loops

## Architecture

```
┌─────────────────┐         WebSocket          ┌─────────────────┐
│   SPEAKER A     │──────────────────────────▶│   LISTENER B    │
│                 │                            │                 │
│  ┌───────────┐  │         Gemini Live        │  ┌───────────┐  │
│  │  Speech   │──┼──────▶ Transcription ──────▶│  │ Translation│──┼──▶ Spanish
│  │  (Mic)    │  │         API                 │  │ (API)     │  │
│  └───────────┘  │                            │  └───────────┘  │
│                 │                            │       │         │
│  ┌───────────┐  │                            │  ┌────────▼─┐  │
│  │ Audio Sep │  │                            │  │   TTS     │──┼──▶ Audio
│  │ (Isolated)│  │                            │  │(Cartesia) │  │
│  └───────────┘  │                            │  └───────────┘  │
└─────────────────┘                            └─────────────────┘

                              │
                              ▼                    ┌─────────────────┐
                              │                    │   LISTENER C    │
                              └───────────────────▶│                 │
                                                   │  ┌───────────┐  │
                                                   │  │ Translation│──┼──▶ French
                                                   │  │ (API)     │  │
                                                   │  └───────────┘  │
                                                   │       │         │
                                                   │  ┌────────▼─┐  │
                                                   │  │   TTS     │──┼──▶ Audio
                                                   │  └───────────┘  │
                                                   └─────────────────┘
```

## Key Components

### 1. `useTwoWayTranslation` Hook

**File:** `lib/orbit/hooks/useTwoWayTranslation.ts`

Main hook for bidirectional translation flow:

- Manages speaker/listener roles
- Handles Gemini Live STT connection
- Broadcasts transcriptions via WebSocket
- Receives and processes translations from other users

```typescript
const {
  myRole, // 'speaker' | 'listener' | 'idle'
  setMyRole, // Set role
  isReady, // WebSocket connected
  remoteUsers, // Other users in session
  messages, // All messages
  currentMessage, // Current transcription
  isAudioSeparated, // Audio contexts separated
  isTranscribing, // Speech-to-text active
  isTranslating, // Translation in progress
  isPlaying, // TTS playing
  error, // Error message
  toggleRole, // Switch speaker/listener
  disconnect, // Clean up
} = useTwoWayTranslation({
  meetingId,
  myUserId,
  myUserName,
  myLanguage: LANGUAGES[0],
});
```

### 2. `useHighAccuracyTranscription` Hook

**File:** `lib/orbit/hooks/useHighAccuracyTranscription.ts`

Enhanced STT with accuracy optimizations:

- Audio preprocessing (noise gate, high-pass filter)
- Context boosting for better accuracy
- Confidence scoring per segment
- Automatic retry for low-confidence segments
- Real-time statistics tracking

```typescript
const {
  isTranscribing,
  currentSegment,
  segments,
  stats, // { totalSegments, averageConfidence, wpm }
  confidence, // Current confidence score (0-1)
  isHighConfidence, // confidence >= threshold
  start,
  stop,
  retryLastSegment, // Retry low-confidence segment
  setNoiseGate, // Adjust noise threshold
  setMinConfidence, // Set confidence threshold
} = useHighAccuracyTranscription({
  targetLanguage: 'English',
  enablePreprocessing: true,
  enableContextBoost: true,
  minConfidenceThreshold: 0.85,
  retryLowConfidence: true,
  maxRetries: 2,
});
```

### 3. `AudioSeparationManager`

**File:** `lib/orbit/services/AudioSeparationManager.ts`

Robust audio handling to prevent feedback:

- **Dual AudioContext** - Separate input and output contexts
- **Noise Gate** - Filter below-threshold audio
- **High-pass Filter** - Remove low-frequency noise
- **Smart Ducking** - Reduce TTS volume when user speaks
- **Voice Activity Detection (VAD)** - Detect speech for ducking
- **Hardware Echo Cancellation** - Browser-level AEC

```typescript
const audioManager = new AudioSeparationManager({
  inputSampleRate: 16000,
  outputSampleRate: 24000,
  enableEchoCancellation: true,
  enableNoiseSuppression: true,
  enableAutoGainControl: true,
  outputVolume: 0.8,
  duckingThreshold: 0.02,
  duckingReduction: 0.2,
});

await audioManager.initialize();
const stream = await audioManager.getMicrophoneStream(deviceId);
audioManager.startVAD(); // Enable smart ducking

// Play TTS audio (isolated from input)
await audioManager.playTTSAudio(audioBuffer);

audioManager.dispose(); // Clean up
```

### 4. `TwoWayTranslationPanel` Component

**File:** `lib/orbit/components/TwoWayTranslationPanel.tsx`

UI component with orbit icon:

- Visual role indicators (speaker = red, listener = blue)
- Real-time confidence display
- Audio visualizer
- Remote user list with languages
- Message history

```typescript
<TwoWayTranslationPanel
  meetingId={meetingId}
  myUserId={userId}
  myUserName="User 123"
  myLanguage={LANGUAGES[0]}
/>
```

### 5. WebSocket Translation API

**File:** `app/api/orbit/translation/route.ts`

Server-side event stream for real-time updates:

- User presence tracking
- Transcription broadcast
- Translation completion notifications
- Role change announcements

## Data Flow

### Speaker → Listeners

```
1. User clicks orbit icon → setMyRole('speaker')
2. initializeAudioSeparation() → Creates dual AudioContexts
3. getMicrophoneStream() → Captures audio with echo cancellation
4. startTranscriptionSession() → Gemini Live connection
5. streamAudio() → Base64 PCM audio to Gemini
6. onTranscript() → Receives text from Gemini
7. WebSocket.send({ type: 'transcription', ... }) → All listeners
8. Listeners receive → handleIncomingTranscription()
9. Each listener:
   - translateText(text, theirLanguage)
   - generateTTS(translatedText)
   - playAudio(audioBuffer)
```

### Audio Separation Flow

```
┌────────────────────────────────────────────────────────────┐
│                    INPUT AUDIO CONTEXT                      │
│  Sample Rate: 16000 Hz (Optimized for Speech)              │
│                                                             │
│  Microphone ──▶ Gain Node ──▶ High-Pass Filter ──▶         │
│                               (80 Hz cutoff)                │
│                                     │                       │
│                                     ▼                       │
│                               Analyser Node                │
│                            (for VAD/visualization)          │
│                                     │                       │
│                                     ▼                       │
│                            ScriptProcessor                  │
│                           (convert to PCM16)                │
│                                     │                       │
│                                     ▼                       │
│                               Gemini Live                   │
│                            (WebRTC connection)              │
└─────────────────────────────────────────────────────────────┘

                        ⬇️ (Completely Isolated)

┌────────────────────────────────────────────────────────────┐
│                   OUTPUT AUDIO CONTEXT                      │
│  Sample Rate: 24000 Hz (Optimized for TTS)                  │
│                                                             │
│  Translation API ──▶ Audio Buffer ──▶ Gain Node ──▶        │
│                            (Ducking)                       │
│                              │                              │
│                              ▼                              │
│                     Audio Destination                       │
│                         (Speakers)                          │
└─────────────────────────────────────────────────────────────┘
```

## Usage Examples

### Basic Integration

```typescript
import { useTwoWayTranslation } from '@/lib/orbit/hooks/useTwoWayTranslation';
import { TwoWayTranslationPanel } from '@/lib/orbit/components/TwoWayTranslationPanel';

function MeetingRoom({ meetingId, userId }) {
  const myLanguage = LANGUAGES.find(l => l.code === 'en-US')!;

  return (
    <TwoWayTranslationPanel
      meetingId={meetingId}
      myUserId={userId}
      myUserName="User"
      myLanguage={myLanguage}
    />
  );
}
```

### With High Accuracy Transcription

```typescript
import { useHighAccuracyTranscription } from '@/lib/orbit/hooks/useHighAccuracyTranscription';
import { HighAccuracyTranscriptionPanel } from '@/lib/orbit/components/HighAccuracyTranscriptionPanel';

function SpeakerMode({ stream, onTranscript }) {
  return (
    <HighAccuracyTranscriptionPanel
      stream={stream}
      isActive={true}
      targetLanguage="English"
      onTranscript={onTranscript}
    />
  );
}
```

### Custom Integration with Audio Separation

```typescript
import { AudioSeparationManager } from '@/lib/orbit/services/AudioSeparationManager';

const audioManager = new AudioSeparationManager({
  enableEchoCancellation: true,
  enableNoiseSuppression: true,
});

// Initialize audio separation
await audioManager.initialize();

// Get optimized microphone stream
const stream = await audioManager.getMicrophoneStream(deviceId);

// Start VAD for smart ducking
audioManager.startVAD();

// Play TTS (automatically isolated from input)
await audioManager.playTTSAudio(audioBuffer);

// Clean up
audioManager.dispose();
```

## Accuracy Optimizations

### 1. Audio Preprocessing

```typescript
// High-pass filter removes low-frequency noise
const highPassFilter = audioContext.createBiquadFilter();
highPassFilter.type = 'highpass';
highPassFilter.frequency.value = 80; // Hz
```

### 2. Noise Gate

```typescript
// Filter audio below threshold
if (averageVolume < noiseThreshold) {
  gainNode.gain.setTargetAtTime(0.01, audioContext.currentTime, 0.01);
} else {
  gainNode.gain.setTargetAtTime(1.0, audioContext.currentTime, 0.05);
}
```

### 3. Context Boosting

```typescript
// Use previous transcriptions for context
const context = previousSegments.slice(-3).join(' ');
const improved = await translateWithGPT(`Correct: "${transcription}"
Context: "${context}"
Output: ONLY corrected text`);
```

### 4. Confidence Scoring

```typescript
function calculateConfidence(text: string, duration: number): number {
  let score = 0.9;
  // Longer = more confident
  if (wordCount >= 3) score += 0.03;
  // Appropriate duration
  if (Math.abs(duration - expected) < 0.3 * expected) score += 0.03;
  // Ends with punctuation
  if (/[.!?]$/.test(text)) score += 0.02;
  // No repeated words
  if (uniqueWords / totalWords < 0.7) score -= 0.1;
  return Math.max(0, Math.min(1, score));
}
```

### 5. Automatic Retry

```typescript
// Retry low-confidence segments
if (confidence < 0.85 && retryCount < maxRetries) {
  const improved = await retryWithGPT(segment);
  if (improved.confidence > original.confidence) {
    useImproved();
  }
}
```

## Language Support

The system supports 600+ languages including:

- All major world languages
- Regional variants (e.g., es-MX, pt-BR, fr-CA)
- Indigenous and minority languages
- Dialect variations

See `lib/orbit/types.ts` for the complete list in `LANGUAGES` array.

## Environment Variables

```bash
# STT/Translation/TTS APIs
NEXT_PUBLIC_GEMINI_API_KEY=your_key
GEMINI_API_KEY=your_key

# WebSocket Server (for production)
WEBSOCKET_URL=wss://your-server.com/api/ws/translation

# TTS Provider
CARTESIA_API_KEY=your_key

# Database (for persistence)
NEXT_PUBLIC_SUPABASE_URL=your_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_key
```

## Performance Characteristics

| Operation           | Latency    | Notes                 |
| ------------------- | ---------- | --------------------- |
| STT (Gemini Live)   | 200-500ms  | WebSocket streaming   |
| Translation (API)   | 500-1000ms | Per-language parallel |
| TTS (Cartesia)      | 500-1000ms | Per-language          |
| Audio Separation    | <10ms      | Hardware accelerated  |
| WebSocket Broadcast | 50-100ms   | Per connected user    |

**Total End-to-End:** ~1.5-2.5 seconds

## Troubleshooting

### Echo Issues

```typescript
// Ensure echo cancellation is on
const stream = await navigator.mediaDevices.getUserMedia({
  audio: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  },
});

// Use AudioSeparationManager for additional isolation
audioManager.startVAD(); // Enable smart ducking
```

### Low Accuracy

```typescript
// Increase confidence threshold
setMinConfidence(0.9);

// Enable preprocessing
const { start } = useHighAccuracyTranscription({
  enablePreprocessing: true,
  retryLowConfidence: true,
  maxRetries: 3,
});

// Adjust noise gate
setNoiseGate(0.05); // Higher = more aggressive filtering
```

### Connection Issues

```typescript
// Check WebSocket state
if (ws.readyState !== WebSocket.OPEN) {
  // Reconnect
  connectWebSocket();
}

// Check ready state
const { isReady } = useTwoWayTranslation({...});
if (!isReady) {
  // Show connecting indicator
}
```

## Files Structure

```
lib/orbit/
├── hooks/
│   ├── useTwoWayTranslation.ts          # Main bidirectional hook
│   ├── useTwoWayTranslationEnhanced.ts  # With audio separation
│   ├── useHighAccuracyTranscription.ts  # Accuracy-optimized STT
│   ├── useDeepgramLive.ts               # Alternative STT provider
│   └── useRealtimeTranslation.ts        # Simple translation hook
├── components/
│   ├── TwoWayTranslationPanel.tsx       # Main UI with orbit icon
│   ├── HighAccuracyTranscriptionPanel.tsx
│   ├── TranslatorDock.tsx              # Dock UI
│   └── RealtimeTranslationListener.tsx  # Listener component
├── services/
│   ├── AudioSeparationManager.ts        # Audio isolation
│   ├── geminiService.ts                 # Gemini Live API
│   ├── orbitService.ts                  # Supabase operations
│   └── supabaseClient.ts                # Database client
└── types.ts                            # TypeScript types

app/api/orbit/
├── translation/route.ts                 # WebSocket server
├── translate/route.ts                   # Translation API
└── tts/route.ts                         # TTS API
```

## Security Considerations

1. **API Keys**: Never expose API keys in client code
2. **Authentication**: Validate user sessions before WebSocket connections
3. **Rate Limiting**: Implement per-user rate limits
4. **Input Validation**: Sanitize all WebSocket messages
5. **Encryption**: Use WSS (secure WebSocket) in production

## Future Enhancements

1. **Multi-Speaker Diarization**: Identify different speakers
2. **Voice Cloning**: Preserve speaker voice in translations
3. **Offline Mode**: Fallback to on-device STT
4. **Push-to-Talk**: Optional PTT for speaker control
5. **Recording**: Save translation sessions for review
