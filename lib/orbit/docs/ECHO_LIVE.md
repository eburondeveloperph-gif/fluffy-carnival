# Echo Live - Simplified Real-Time Translation

## Overview

Echo Live provides **one-session real-time translation** using Gemini Live API:

- Speak → Real-time transcription displayed
- Automatic translation + TTS playback
- No separate APIs for STT, translation, and TTS

## Quick Start

```tsx
import { EchoLivePanel } from '@/lib/orbit/components/EchoLivePanel';

function App() {
  return (
    <EchoLivePanel
      targetLanguage="Spanish"
      onTranscript={(text) => console.log('You said:', text)}
      onTranslation={(text) => console.log('Translation:', text)}
    />
  );
}
```

## How It Works

```
┌─────────────────────────────────────────────────────────┐
│                    ECHO LIVE SESSION                      │
│                                                          │
│  ┌─────────────┐     WebSocket      ┌─────────────────┐  │
│  │  Microphone │ ───SEND PCM16───▶ │  Gemini Live    │  │
│  │  (16kHz)    │                   │  API            │  │
│  └─────────────┘                   │                 │  │
│                                    │  • Transcribes   │  │
│                                    │  • Translates    │  │
│                                    │  • Synthesizes   │  │
│  ┌─────────────┐     PCM16      ◀──│                 │  │
│  │  Speakers   │◀───RECEIVE────────│                 │  │
│  │  (24kHz)    │                   └─────────────────┘  │
│  └─────────────┘                                          │
│                                                          │
│  ┌─────────────────────────────────────────────────────┐│
│  │  DISPLAY:                                            ││
│  │  [ORIGINAL]: Hello, how are you?                    ││
│  │  [SPANISH]: Hola, ¿cómo estás?                      ││
│  └─────────────────────────────────────────────────────┘│
│                                                          │
└─────────────────────────────────────────────────────────┘
```

## One Session, Everything Included

No need for:

- ❌ Separate STT API call
- ❌ Separate Translation API call
- ❌ Separate TTS API call

Just:

- ✅ One WebSocket connection
- ✅ Send audio → Receive audio + text

## Hook Usage

```tsx
import { useEchoLive } from '@/lib/orbit/hooks/useEchoLive';

function MyComponent() {
  const {
    isConnected,
    isListening,
    isSpeaking,
    status,
    connect,
    disconnect,
    startMicrophone,
    stopMicrophone,
  } = useEchoLive({
    apiKey: process.env.NEXT_PUBLIC_GEMINI_API_KEY,
    targetLanguage: 'Spanish',
    systemPrompt:
      'You are a translator. When you hear speech, translate it to Spanish and speak the translation.',
    onTranscript: (text, isFinal) => {
      console.log('Transcript:', text, isFinal ? '(final)' : '(interim)');
    },
    onAudioChunk: (pcmData) => {
      // Optional: visualize audio
    },
  });

  return (
    <div>
      <button onClick={isConnected ? disconnect : connect}>
        {isConnected ? 'Disconnect' : 'Connect'}
      </button>

      <button onClick={isListening ? stopMicrophone : startMicrophone}>
        {isListening ? 'Stop Mic' : 'Start Mic'}
      </button>

      <p>Status: {status}</p>
    </div>
  );
}
```

## Audio Format

- **Input**: PCM16, 16kHz, mono
- **Output**: PCM16, 24kHz, mono
- **WebSocket**: Binary messages for audio, JSON for control

## System Prompt

The default prompt instructs the model to:

1. Transcribe what it hears
2. Translate to target language
3. Speak the translation

```typescript
const defaultPrompt = `You are a real-time translator.
When you hear speech:
1. Transcribe it exactly
2. Translate to ${targetLanguage}
3. Speak the translation naturally

Format:
[ORIGINAL]: <transcription>
[${targetLanguage.toUpperCase()}]: <translation>
`;
```

## Environment Variables

```bash
# Only required variable
NEXT_PUBLIC_GEMINI_API_KEY=your_key
```

## Performance

| Metric                | Value                |
| --------------------- | -------------------- |
| Latency (STT)         | 200-400ms            |
| Latency (Translation) | 500-800ms            |
| Latency (TTS)         | Included in response |
| **Total**             | **0.7-1.2 seconds**  |

## Comparison

| Approach      | APIs Used                 | Latency | Complexity |
| ------------- | ------------------------- | ------- | ---------- |
| **Echo Live** | 1 (Gemini Live)           | ~1s     | Low        |
| Old approach  | 3 (STT + Translate + TTS) | ~2.5s   | High       |

## Files

```
lib/orbit/hooks/useEchoLive.ts     # Hook implementation
lib/orbit/components/EchoLivePanel.tsx  # Ready-to-use component
app/echo/page.tsx                   # Demo page
```
