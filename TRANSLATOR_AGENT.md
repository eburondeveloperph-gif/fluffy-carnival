# Eburon Translator Agent Setup

This LiveKit agent handles real-time translation with STT → LLM → TTS pipeline.

## Prerequisites

1. Install Python dependencies:

```bash
pip install livekit livekit-agents python-dotenv
```

2. Create `.env.local`:

```env
LIVEKIT_URL=https://your-livekit-server.com
LIVEKIT_API_KEY=your_api_key
LIVEKIT_API_SECRET=your_api_secret
GEMINI_API_KEY=your_gemini_key
DEEPGRAM_API_KEY=your_deepgram_key
CARTESIA_API_KEY=your_cartesia_key
```

## Run the agent

```bash
python agent.py
```

## Connect from frontend

The agent will connect to LiveKit rooms and handle translation automatically. Configure your LiveKit server URL in the environment.
