import { NextResponse } from 'next/server';
import {
  sanitizeErrorMessage,
  logInfo,
  logError,
  STATUS_MESSAGES,
  SERVICE_ALIASES,
} from '@/lib/orbit/config/serviceAliases';

/**
 * Echo TTS API
 *
 * Synthesizes speech using Kokoro TTS.
 */
export async function POST(request: Request) {
  try {
    const { text, provider = 'echo' } = await request.json();

    if (!text) {
      return NextResponse.json(
        {
          error: 'Missing text parameter',
          message: 'Please provide text to synthesize.',
        },
        { status: 400 },
      );
    }

    logInfo('ECHO', `Synthesizing ${text.length} characters`);

    // Try Kokoro TTS (local) - per sentence
    const kokoroUrl = process.env.KOKORO_URL || 'http://localhost:5000';
    try {
      logInfo('ECHO', 'Using Kokoro TTS...');

      // Split text into sentences
      const sentences = text.split(/(?<=[.!?])\s+/).filter((s: string) => s.trim().length > 0);
      logInfo('ECHO', `Processing ${sentences.length} sentences`);

      const audioBuffers: ArrayBuffer[] = [];

      for (const sentence of sentences) {
        const cleanSentence = sentence.trim();
        if (!cleanSentence) continue;

        logInfo('ECHO', `Synthesizing: ${cleanSentence}`);

        const kokoroResponse = await fetch(`${kokoroUrl}/tts`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: cleanSentence,
            voice: process.env.KOKORO_VOICE || 'af_sarah',
          }),
        });

        if (kokoroResponse.ok) {
          const buffer = await kokoroResponse.arrayBuffer();
          audioBuffers.push(buffer);
        } else {
          logError('ECHO', `Failed: ${kokoroResponse.status}`);
        }
      }

      if (audioBuffers.length > 0) {
        const totalLength = audioBuffers.reduce((acc, buf) => acc + buf.byteLength, 0);
        const combinedBuffer = new Uint8Array(totalLength);
        let offset = 0;
        for (const buf of audioBuffers) {
          combinedBuffer.set(new Uint8Array(buf), offset);
          offset += buf.byteLength;
        }

        logInfo('ECHO', STATUS_MESSAGES.PLAYING);
        return new NextResponse(combinedBuffer.buffer, {
          headers: { 'Content-Type': 'audio/wav', 'X-Eburon-TTS-Mode': 'kokoro' },
        });
      }
    } catch (e) {
      logError('ECHO', 'Kokoro TTS unavailable');
    }

    // Fallback: return silent audio
    logInfo('ECHO', 'Using fallback silent audio');

    const sampleRate = 24000;
    const duration = 0.5;
    const numSamples = sampleRate * duration;
    const silentBuffer = new Float32Array(numSamples);

    return new NextResponse(silentBuffer.buffer as ArrayBuffer, {
      headers: {
        'Content-Type': 'audio/wav',
        'X-Eburon-TTS-Mode': 'fallback',
      },
    });
  } catch (error) {
    logError('ECHO', error);
    return NextResponse.json(
      {
        error: STATUS_MESSAGES.ERROR,
        message: sanitizeErrorMessage(error),
      },
      { status: 500 },
    );
  }
}
