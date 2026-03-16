import { NextResponse } from 'next/server';
import {
  sanitizeErrorMessage,
  logInfo,
  logError,
  STATUS_MESSAGES,
} from '@/lib/orbit/config/serviceAliases';

/**
 * Echo Translation API
 *
 * Uses Gemini first, falls back to Google Translate.
 */
export async function POST(request: Request) {
  try {
    const { text, targetLang } = await request.json();

    if (!text || !targetLang) {
      return NextResponse.json({ error: 'Missing required parameters' }, { status: 400 });
    }

    logInfo('ECHO', `Translating to ${targetLang}`);

    // Map target languages
    const langMap: Record<string, string> = {
      'Tagalog-English mix (Taglish)': 'tl',
      Spanish: 'es',
      French: 'fr',
      German: 'de',
      Japanese: 'ja',
      Chinese: 'zh-CN',
      Korean: 'ko',
      Dutch: 'nl',
      Portuguese: 'pt',
      Italian: 'it',
      Russian: 'ru',
      Tagalog: 'tl',
      English: 'en',
    };
    const targetCode = langMap[targetLang] || 'en';

    // Try Gemini first
    const geminiKey = process.env.GEMINI_API_KEY;
    if (geminiKey) {
      try {
        logInfo('ECHO', 'Using Gemini...');

        const geminiResponse = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [
                {
                  parts: [
                    {
                      text: `Translate to ${targetLang}. Output ONLY the translated text:\n\n${text}`,
                    },
                  ],
                },
              ],
              generationConfig: { temperature: 0.1 },
            }),
          },
        );

        if (geminiResponse.ok) {
          const data = await geminiResponse.json();
          const translation = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
          if (translation) {
            logInfo('ECHO', STATUS_MESSAGES.COMPLETE);
            return NextResponse.json({ translation });
          }
        }
      } catch (e) {
        logError('ECHO', 'Gemini failed, trying Google Translate...');
      }
    }

    // Fallback: Google Translate
    try {
      logInfo('ECHO', 'Using Google Translate...');

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
    } catch (e) {
      logError('ECHO', 'Google Translate also failed');
    }

    return NextResponse.json({ error: 'Translation unavailable' }, { status: 503 });
  } catch (error) {
    logError('ECHO', error);
    return NextResponse.json({ error: sanitizeErrorMessage(error) }, { status: 500 });
  }
}
