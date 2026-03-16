import { NextResponse } from 'next/server';
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';

let session: any = null;
let responseQueue: LiveServerMessage[] = [];
let ai: GoogleGenAI | null = null;

async function waitForMessage(): Promise<LiveServerMessage> {
  while (responseQueue.length === 0) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return responseQueue.shift()!;
}

/**
 * Echo TTS API
 *
 * Uses Gemini Live Audio for text-to-speech.
 */
export async function POST(request: Request) {
  try {
    const { text, voice = 'Kore' } = await request.json();

    if (!text) {
      return NextResponse.json({ error: 'Missing text parameter' }, { status: 400 });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      // Fallback: return silent audio
      const silentBuffer = new Float32Array(24000 * 0.5);
      return new NextResponse(silentBuffer.buffer as ArrayBuffer, {
        headers: { 'Content-Type': 'audio/wav', 'X-Eburon-TTS-Mode': 'fallback' },
      });
    }

    if (!ai) {
      ai = new GoogleGenAI({ apiKey });
    }

    const model = 'gemini-2.0-flash-live-001';

    session = await ai.live.connect({
      model,
      callbacks: {
        onopen: () => {},
        onmessage: (msg: LiveServerMessage) => responseQueue.push(msg),
        onerror: (e: any) => console.error('Error:', e),
        onclose: () => {},
      },
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: voice },
          },
        },
      },
    });

    // Split into sentences for smoother streaming
    const sentences = text.split(/(?<=[.!?])\s+/).filter((s: string) => s.trim());
    const audioChunks: string[] = [];
    let fullText = '';

    for (const sentence of sentences) {
      responseQueue = [];
      session.sendClientContent({ turns: [sentence] });

      let done = false;
      while (!done) {
        const msg = await waitForMessage();
        const part = msg.serverContent?.modelTurn?.parts?.[0];

        if (part?.text) fullText += part.text;
        if (part?.inlineData?.data) audioChunks.push(part.inlineData.data);
        if (msg.serverContent?.turnComplete) done = true;
      }
    }

    session.close();
    session = null;

    // Convert base64 chunks to binary
    if (audioChunks.length > 0) {
      const combined = audioChunks.join('');
      const binary = Buffer.from(combined, 'base64');
      return new NextResponse(binary, {
        headers: { 'Content-Type': 'audio/wav', 'X-Eburon-TTS-Mode': 'gemini-live' },
      });
    }

    // Fallback
    const silentBuffer = new Float32Array(24000 * 0.5);
    return new NextResponse(silentBuffer.buffer as ArrayBuffer, {
      headers: { 'Content-Type': 'audio/wav', 'X-Eburon-TTS-Mode': 'fallback' },
    });
  } catch (error) {
    console.error('TTS error:', error);
    const silentBuffer = new Float32Array(24000 * 0.5);
    return new NextResponse(silentBuffer.buffer as ArrayBuffer, {
      headers: { 'Content-Type': 'audio/wav', 'X-Eburon-TTS-Mode': 'fallback' },
    });
  }
}
