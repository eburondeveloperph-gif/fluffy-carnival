import { NextResponse } from 'next/server';
import {
  sanitizeErrorMessage,
  logInfo,
  logError,
  STATUS_MESSAGES,
} from '@/lib/orbit/config/serviceAliases';

/**
 * Eburon AI Translation API
 *
 * Translates text using Google Translate (free, no API key).
 */
export async function POST(request: Request) {
  try {
    const { text, targetLang } = await request.json();

    if (!text || !targetLang) {
      return NextResponse.json(
        {
          error: 'Missing required parameters',
          message: 'Please provide text and target language.',
        },
        { status: 400 },
      );
    }

    logInfo('ECHO', `Processing translation to ${targetLang}`);

    // Map target languages to Google Translate codes
    const langMap: Record<string, string> = {
      'Tagalog-English mix (Taglish)': 'tl',
      Spanish: 'es',
      French: 'fr',
      German: 'de',
      Japanese: 'ja',
      Chinese: 'zh-CN',
      'Chinese Simplified': 'zh-CN',
      'Chinese Traditional': 'zh-TW',
      Korean: 'ko',
      Portuguese: 'pt',
      Italian: 'it',
      Russian: 'ru',
      Dutch: 'nl',
      Tagalog: 'tl',
      English: 'en',
    };
    const targetCode = langMap[targetLang] || 'en';

    // Use Google Translate web endpoint (no API key needed)
    const encodedText = encodeURIComponent(text);
    const googleUrl = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${targetCode}&dt=t&q=${encodedText}`;

    const googleResponse = await fetch(googleUrl);

    if (googleResponse.ok) {
      const data = await googleResponse.json();
      const translation = data[0]?.[0]?.[0];
      if (translation) {
        logInfo('ECHO', STATUS_MESSAGES.COMPLETE);
        return NextResponse.json({ translation });
      }
    }

    logError('ECHO', 'Translation failed');
    return NextResponse.json(
      {
        error: STATUS_MESSAGES.ERROR,
        message: 'Translation service unavailable.',
      },
      { status: 503 },
    );
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
