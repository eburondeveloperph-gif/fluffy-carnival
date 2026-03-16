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
 * Transcribes audio using Echo STT Engine.
 * Never exposes internal provider names in errors or responses.
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

    const apiKey = process.env.DEEPGRAM_API_KEY || process.env.ORBIT_API_KEY;
    if (!apiKey) {
      logError('ECHO', 'No API key configured');
      return NextResponse.json(
        {
          error: STATUS_MESSAGES.ERROR,
          message: 'Echo is not configured. Please contact support.',
        },
        { status: 503 },
      );
    }

    // Convert blob to array buffer
    const arrayBuffer = await audioBlob.arrayBuffer();

    // Build API URL with parameters (whitelisted provider)
    let sttUrl = 'https://api.deepgram.com/v1/listen?model=nova-2&punctuate=true&smart_format=true';
    if (language === 'auto') {
      sttUrl += '&detect_language=true';
    } else {
      sttUrl += `&language=${language}`;
    }

    logInfo('ECHO', STATUS_MESSAGES.PROCESSING);

    // Call STT API
    const response = await fetch(sttUrl, {
      method: 'POST',
      headers: {
        Authorization: `Token ${apiKey}`,
        'Content-Type': audioBlob.type || 'audio/webm',
      },
      body: arrayBuffer,
    });

    if (!response.ok) {
      const err = await response.text();
      logError('ECHO', `Transcription failed: ${response.status}`);

      return NextResponse.json(
        {
          error: STATUS_MESSAGES.ERROR,
          message: 'Echo encountered an issue. Please try again.',
        },
        { status: response.status >= 500 ? 503 : 400 },
      );
    }

    const data = await response.json();
    const transcript = data.results?.channels?.[0]?.alternatives?.[0]?.transcript || '';
    const confidence = data.results?.channels?.[0]?.alternatives?.[0]?.confidence || 0;

    logInfo(
      'ECHO',
      `Transcription complete (${transcript.length} chars, confidence: ${(confidence * 100).toFixed(0)}%)`,
    );

    return NextResponse.json({
      transcript: transcript.trim(),
      confidence,
      engine: 'Echo',
      version: '2.5',
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
