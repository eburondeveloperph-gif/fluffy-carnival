import { NextResponse } from 'next/server';
import {
  sanitizeErrorMessage,
  logInfo,
  logError,
  STATUS_MESSAGES,
} from '@/lib/orbit/config/serviceAliases';

/**
 * Echo TTS API
 *
 * Uses Cartesia Sonic 3 for multilingual TTS.
 */
export async function POST(request: Request) {
  try {
    const { text, language = 'en' } = await request.json();

    if (!text) {
      return NextResponse.json({ error: 'Missing text parameter' }, { status: 400 });
    }

    logInfo('ECHO', `Synthesizing: ${text.substring(0, 50)}...`);

    // Map frontend languages to Cartesia language codes
    const langMap: Record<string, string> = {
      'Tagalog-English mix (Taglish)': 'tl',
      Tagalog: 'tl',
      Spanish: 'es',
      French: 'fr',
      German: 'de',
      Japanese: 'ja',
      Chinese: 'zh',
      Korean: 'ko',
      Dutch: 'nl',
      English: 'en',
    };
    const cartesiaLang = langMap[language] || 'en';

    // Try Cartesia first
    const cartesiaKey = process.env.CARTESIA_API_KEY;
    if (cartesiaKey) {
      try {
        logInfo('ECHO', 'Using Cartesia Sonic 3...');

        // Split into sentences for better synthesis
        const sentences = text.split(/(?<=[.!?])\s+/).filter((s: string) => s.trim());

        const audioBuffers: ArrayBuffer[] = [];

        for (const sentence of sentences) {
          const cleanSentence = sentence.trim();
          if (!cleanSentence) continue;

          const response = await fetch('https://api.cartesia.ai/tts/bytes', {
            method: 'POST',
            headers: {
              'Cartesia-Version': '2025-04-16',
              'X-API-Key': cartesiaKey,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model_id: 'sonic-3',
              transcript: cleanSentence,
              voice: {
                mode: 'id',
                id: '87286a8d-7ea7-4235-a41a-dd9fa6630feb', // Multilingual voice
              },
              output_format: {
                container: 'wav',
                encoding: 'pcm_f32le',
                sample_rate: 44100,
              },
              language: cartesiaLang,
              speed: 'normal',
              generation_config: {
                speed: 1,
                volume: 1,
                emotion: 'neutral',
              },
            }),
          });

          if (response.ok) {
            const buffer = await response.arrayBuffer();
            audioBuffers.push(buffer);
          } else {
            logError('ECHO', `Cartesia error: ${response.status}`);
          }
        }

        if (audioBuffers.length > 0) {
          // Combine audio buffers
          const totalLength = audioBuffers.reduce((acc, buf) => acc + buf.byteLength, 0);
          const combined = new Uint8Array(totalLength);
          let offset = 0;
          for (const buf of audioBuffers) {
            combined.set(new Uint8Array(buf), offset);
            offset += buf.byteLength;
          }

          logInfo('ECHO', STATUS_MESSAGES.PLAYING);
          return new NextResponse(combined.buffer, {
            headers: { 'Content-Type': 'audio/wav', 'X-Eburon-TTS-Mode': 'cartesia' },
          });
        }
      } catch (e) {
        logError('ECHO', 'Cartesia unavailable');
      }
    }

    // Fallback: return silent audio
    logInfo('ECHO', 'Using fallback silent audio');
    const silentBuffer = new Float32Array(44100 * 0.5);
    return new NextResponse(silentBuffer.buffer as ArrayBuffer, {
      headers: { 'Content-Type': 'audio/wav', 'X-Eburon-TTS-Mode': 'fallback' },
    });
  } catch (error) {
    logError('ECHO', error);
    const silentBuffer = new Float32Array(44100 * 0.5);
    return new NextResponse(silentBuffer.buffer as ArrayBuffer, {
      headers: { 'Content-Type': 'audio/wav', 'X-Eburon-TTS-Mode': 'fallback' },
    });
  }
}
