# Orbit Real-Time Translation System

## Overview

The Orbit translation system enables real-time speech translation between users using WebSocket connections, AI translation APIs, and text-to-speech (TTS) synthesis.

## Architecture Flow

### 1. Speaking Mode (Transcription)

```
User Speech → Microphone → WebSocket STT (Deepgram) → Text Transcription → Supabase Realtime
```

**Implementation:**

- `useOrbitMic.ts` - Direct WebSocket to Deepgram for STT
- `useDeepgramLive.ts` - Enhanced STT with accuracy optimizations
- `OrbitApp.tsx:397-458` - Gemini transcription session
- Transcriptions stored in `transcriptions` table

**Key Code:**

```typescript
// From useOrbitMic.ts
const socket = new WebSocket(url, ['token', ORBIT_API_KEY]);
socket.onmessage = (msg) => {
  const data = JSON.parse(msg.data);
  const text = data.channel?.alternatives?.[0]?.transcript;
  if (data.is_final) {
    // Save to Supabase
    await supabase.from('transcriptions').insert({...});
  }
};
```

### 2. Listening Mode (Translation + TTS)

```
Supabase Realtime → Text Received → Translation API → TTS API → Audio Playback
```

**Implementation:**

- `useRealtimeTranslation.ts` - New hook for the pipeline
- `OrbitApp.tsx:660-686` - Supabase Realtime subscription
- `OrbitApp.tsx:244-304` - Translation and TTS processing queue

**Key Code:**

```typescript
// From OrbitApp.tsx
const channel = supabase.channel(`room:${meetingId}:transcripts`).on(
  'postgres_changes',
  {
    event: 'INSERT',
    table: 'transcriptions',
  },
  (payload) => {
    if (mode === 'listening') {
      processingQueueRef.current.push({
        text: payload.new.transcribe_text_segment,
        id: payload.new.id,
      });
      processNextInQueue();
    }
  },
);
```

### 3. Processing Pipeline

```typescript
// Step 1: Translate
const tRes = await fetch('/api/orbit/translate', {
  method: 'POST',
  body: JSON.stringify({ text, targetLang }),
});
const { translation } = await tRes.json();

// Step 2: TTS (if in listening mode)
const ttsRes = await fetch('/api/orbit/tts', {
  method: 'POST',
  body: JSON.stringify({ text: translation }),
});
const audioBuffer = await ttsRes.arrayBuffer();

// Step 3: Play audio
audioQueueRef.current.push(audioBuffer);
playNextAudio();
```

## API Endpoints

### POST `/api/orbit/translate`

Translates text using AI models (Ollama → DeepSeek → Gemini fallback chain)

**Request:**

```json
{
  "text": "Hello world",
  "targetLang": "Spanish"
}
```

**Response:**

```json
{
  "translation": "Hola mundo"
}
```

### POST `/api/orbit/tts`

Converts text to speech using Cartesia API

**Request:**

```json
{
  "text": "Hola mundo"
}
```

**Response:** Audio buffer (WAV format)

### POST `/api/orbit/stt`

Transcribes audio file using Deepgram

**Request:** FormData with `audio` blob and `language`

**Response:**

```json
{
  "transcript": "Hello world",
  "confidence": 0.95
}
```

## Usage Examples

### Example 1: Using the Component

```tsx
import { RealtimeTranslationListener } from '@/lib/orbit/components/RealtimeTranslationListener';

function MyComponent() {
  return (
    <RealtimeTranslationListener
      meetingId={meetingId}
      myUserId={userId}
      targetLanguage="Spanish"
      isListening={mode === 'listening'}
    />
  );
}
```

### Example 2: Using the Hook

```tsx
import { useRealtimeTranslation } from '@/lib/orbit/hooks/useRealtimeTranslation';

function MyComponent() {
  const { currentText, isProcessing, isPlaying } = useRealtimeTranslation({
    meetingId,
    myUserId,
    targetLanguage: 'Spanish',
    enabled: isListening,
  });

  return (
    <div>
      {currentText && <p>{currentText}</p>}
      {isPlaying && <span>Speaking...</span>}
    </div>
  );
}
```

### Example 3: Orbit Icon Integration

```tsx
<button onClick={toggleListen} className={`orbit-icon ${isListening ? 'active' : ''}`}>
  <Globe className="w-6 h-6" />
  {isListening && <span className="pulse-ring" />}
</button>;

{
  isListening && (
    <RealtimeTranslationListener
      meetingId={meetingId}
      myUserId={MY_USER_ID}
      targetLanguage={selectedLanguage.name}
      isListening={isListening}
    />
  );
}
```

## File Structure

```
lib/orbit/
├── OrbitApp.tsx                    # Main app with listening/speaking modes
├── hooks/
│   ├── useOrbitMic.ts             # WebSocket STT (Deepgram)
│   ├── useDeepgramLive.ts         # Enhanced STT hook
│   └── useRealtimeTranslation.ts  # NEW: Translation + TTS pipeline
├── components/
│   ├── TranslatorDock.tsx         # Main UI with orbit icon
│   ├── RealtimeTranslationListener.tsx  # NEW: Drop-in component
│   └── TranslatorPanel.tsx        # Panel UI
├── services/
│   ├── orbitService.ts            # Supabase operations
│   └── supabaseClient.ts          # Supabase client
└── examples/
    ├── ListeningModeIntegration.tsx   # NEW: Integration examples
    └── WebSocketTranslationServer.ts  # NEW: WebSocket architecture

app/api/orbit/
├── translate/route.ts             # Translation API
├── tts/route.ts                   # TTS API
└── stt/route.ts                   # STT API
```

## Key Features

1. **WebSocket STT**: Real-time transcription via Deepgram WebSocket
2. **Supabase Realtime**: WebSocket-based transcription broadcasting
3. **AI Translation**: Multi-provider fallback (Ollama → DeepSeek → Gemini)
4. **TTS Synthesis**: Cartesia API for natural-sounding speech
5. **Sequential Playback**: Audio queue ensures translations play in order
6. **Audio Visualization**: Real-time audio level display during playback

## Modes

### Speaking Mode

- Captures microphone input
- Streams to STT service via WebSocket
- Stores transcriptions in database
- Broadcasts to all listeners via Supabase Realtime

### Listening Mode

- Subscribes to transcription events
- Translates received text to target language
- Generates TTS audio
- Plays audio sequentially
- Displays translated text

### Idle Mode

- No active processing
- Maintains connection for quick mode switching

## Performance Considerations

1. **Latency**:
   - STT: ~200-500ms (WebSocket)
   - Translation: ~500-1000ms (API call)
   - TTS: ~500-1000ms (API call)
   - Total: ~1.5-2.5 seconds end-to-end

2. **Optimization**:
   - Processing queue prevents bottlenecks
   - Audio queue ensures sequential playback
   - Supabase Realtime provides automatic reconnection

3. **Alternatives**:
   - WebSocket translation server (lower latency but more complex)
   - Server-Sent Events (SSE) for one-way streaming
   - Keep current architecture for simplicity

## Environment Variables

```bash
# STT
NEXT_PUBLIC_DEEPGRAM_API_KEY=your_key

# Translation
GEMINI_API_KEY=your_key
DEEPSEEK_API_KEY=your_key (optional)
OLLAMA_BASE_URL=http://localhost:11434 (optional)

# TTS
CARTESIA_API_KEY=your_key
CARTESIA_VERSION=2025-04-16
CARTESIA_MODEL_ID=sonic-3-latest
CARTESIA_VOICE_ID=dda33d93-9f12-4a59-806e-a98279ebf050

# Database
NEXT_PUBLIC_SUPABASE_URL=your_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_key
```

## Testing

1. Start the development server
2. Open two browser windows
3. Window 1: Click "Speak" and speak into microphone
4. Window 2: Click "Listen" to receive translations
5. Verify translations appear and audio plays

## Troubleshooting

- **No audio**: Check AudioContext is initialized (requires user interaction)
- **No translations**: Verify Supabase Realtime is enabled
- **High latency**: Check API keys are configured correctly
- **WebSocket errors**: Verify Deepgram API key and network connectivity
