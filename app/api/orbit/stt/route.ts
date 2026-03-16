import { NextResponse } from 'next/server';
import {
  sanitizeErrorMessage,
  logInfo,
  logError,
  STATUS_MESSAGES,
} from '@/lib/orbit/config/serviceAliases';

/**
 * Echo STT API
 *
 * Transcribes audio using local Whisper server.
 */
export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const audioBlob = formData.get('audio') as Blob;
    const language = (formData.get('language') as string) || 'en';

    if (!audioBlob) {
      return NextResponse.json(
        {
          error: 'Missing audio data',
          message: 'Please provide audio data to transcribe.',
        },
        { status: 400 },
      );
    }

    logInfo('ECHO', `Processing audio (${audioBlob.size} bytes, language: ${language})`);

    // Try local Whisper server first
    const whisperUrl = process.env.WHISPER_URL || 'http://localhost:7860';
    try {
      logInfo('ECHO', 'Using local Whisper...');

      const arrayBuffer = await audioBlob.arrayBuffer();

      const whisperResponse = await fetch(`${whisperUrl}/transcribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'audio/wav' },
        body: arrayBuffer,
      });

      if (whisperResponse.ok) {
        const data = await whisperResponse.json();
        const transcript = data.text || '';

        logInfo('ECHO', `Transcription complete (${transcript.length} chars)`);

        return NextResponse.json({
          transcript: transcript.trim(),
          confidence: 0.9,
          engine: 'Whisper',
          version: 'local',
        });
      } else {
        logError('ECHO', `Whisper failed: ${whisperResponse.status}`);
      }
    } catch (e) {
      logError('ECHO', 'Local Whisper unavailable');
    }

    // Fallback: return empty transcript
    logInfo('ECHO', 'Using fallback (no transcription)');

    return NextResponse.json({
      transcript: '',
      confidence: 0,
      engine: 'Echo',
      version: 'fallback',
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
