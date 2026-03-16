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
 * Synthesizes speech using Echo TTS (Cartesia).
 * Never exposes internal provider names in errors or responses.
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

    const apiKey = process.env.ORBIT_API_KEY || process.env.CARTESIA_API_KEY;

    // No API key - return silent audio
    if (!apiKey) {
      logInfo('ECHO', 'Using fallback silent audio');

      // Generate 0.5s silence (fallback mode)
      const sampleRate = 24000;
      const duration = 0.5;
      const numSamples = sampleRate * duration;
      const buffer = new Float32Array(numSamples);
      // Already initialized to 0 (silence)

      return new NextResponse(buffer.buffer as ArrayBuffer, {
        headers: {
          'Content-Type': 'audio/wav',
          'X-Eburon-TTS-Mode': 'fallback',
        },
      });
    }

    logInfo('ECHO', STATUS_MESSAGES.SYNTHESIZING);

    // Use Cartesia API (whitelisted TTS provider)
    const response = await fetch('https://api.cartesia.ai/tts/bytes', {
      method: 'POST',
      headers: {
        'Cartesia-Version': process.env.CARTESIA_VERSION || '2025-04-16',
        'X-API-Key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model_id: process.env.CARTESIA_MODEL_ID || 'sonic-3-latest', // Whitelisted
        transcript: text,
        voice: {
          mode: 'id',
          id: process.env.CARTESIA_VOICE_ID || 'dda33d93-9f12-4a59-806e-a98279ebf050',
        },
        output_format: {
          container: 'wav',
          encoding: 'pcm_f32le',
          sample_rate: 24000,
        },
        speed: 'normal',
        generation_config: { speed: 1, volume: 1 },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      logError('ECHO', `Synthesis failed: ${response.status}`);

      return NextResponse.json(
        {
          error: STATUS_MESSAGES.ERROR,
          message: 'Echo TTS encountered an issue. Please try again.',
        },
        { status: response.status >= 500 ? 503 : 400 },
      );
    }

    const buffer = await response.arrayBuffer();

    logInfo('ECHO', STATUS_MESSAGES.PLAYING);

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'audio/wav',
        'X-Eburon-TTS-Mode': 'synthesized',
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
