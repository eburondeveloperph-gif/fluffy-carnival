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
 * Uses browser Web Speech API via client-side transcription.
 * This endpoint serves as a placeholder - actual transcription
 * happens in the browser using Web Speech API or WebGPU.
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

    logInfo('ECHO', `Received audio (${audioBlob.size} bytes)`);

    // For now, return empty - transcription is handled client-side
    // with Web Speech API or WebGPU
    return NextResponse.json({
      transcript: '',
      confidence: 0,
      engine: 'WebSpeech',
      version: 'browser',
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
