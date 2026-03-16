import { NextResponse } from 'next/server';
import {
  sanitizeErrorMessage,
  logInfo,
  logError,
  getModelId,
  SERVICE_ALIASES,
  STATUS_MESSAGES,
} from '@/lib/orbit/config/serviceAliases';

/**
 * Eburon AI Translation API
 *
 * Translates text using Eburon AI (whitelisted LLM providers).
 * Never exposes internal model names in errors or responses.
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

    logInfo('ECHO', `Processing translation request to ${targetLang}`);

    // Try Eburon Translate (Google Translate web) - no API key needed
    try {
      logInfo('ECHO', 'Using Eburon Translate (Google)...');

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
        // Response is array: [[translatedText, originalText, ...], ...]
        const translation = data[0]?.[0]?.[0];
        if (translation) {
          logInfo('ECHO', STATUS_MESSAGES.COMPLETE);
          return NextResponse.json({ translation });
        }
      }
    } catch (e) {
      logError('ECHO', 'Eburon Translate failed, trying next...');
    }

    // Try Ollama (if configured)
    const ollamaUrl = process.env.OLLAMA_BASE_URL;
    if (ollamaUrl) {
      try {
        logInfo('ECHO', 'Using local Ollama...');

        const olResponse = await fetch(`${ollamaUrl}/api/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: getModelId('TRANSLATION_LLM'),
            prompt: `Translate the following text to ${targetLang}. Output ONLY the translated text.\n\nText: ${text}`,
            stream: false,
          }),
        });

        if (olResponse.ok) {
          const data = await olResponse.json();
          const translation = data.response?.trim();
          if (translation) {
            logInfo('ECHO', STATUS_MESSAGES.COMPLETE);
            return NextResponse.json({ translation });
          }
        }
      } catch (e) {
        logError('ECHO', 'Ollama unavailable, trying next...');
      }
    }

    // Try DeepSeek (whitelisted)
    const deepseekKey = process.env.DEEPSEEK_API_KEY;
    if (deepseekKey) {
      try {
        logInfo('ECHO', 'Using Eburon AI cloud...');

        const dsResponse = await fetch('https://api.deepseek.com/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${deepseekKey}`,
          },
          body: JSON.stringify({
            model: 'deepseek-chat', // Whitelisted model
            messages: [
              {
                role: 'system',
                content:
                  'You are Eburon AI, a professional translator. Output ONLY the translated text.',
              },
              { role: 'user', content: `Translate to ${targetLang}:\n\n${text}` },
            ],
            stream: false,
          }),
        });

        if (dsResponse.ok) {
          const data = await dsResponse.json();
          const translation = data.choices?.[0]?.message?.content?.trim();
          if (translation) {
            logInfo('ECHO', STATUS_MESSAGES.COMPLETE);
            return NextResponse.json({ translation });
          }
        }
      } catch (e) {
        logError('ECHO', 'Cloud provider issue, trying fallback...');
      }
    }

    // Fallback to Gemini (whitelisted)
    const geminiKey = process.env.GEMINI_API_KEY || process.env.NEXT_PUBLIC_GEMINI_API_KEY;
    if (!geminiKey) {
      logError('ECHO', 'No service available');
      return NextResponse.json(
        {
          error: STATUS_MESSAGES.ERROR,
          message: 'Eburon AI is temporarily unavailable. Please try again later.',
        },
        { status: 503 },
      );
    }

    logInfo('ECHO', 'Using Eburon AI primary...');

    const model = getModelId('TRANSLATION_LLM');
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`;

    const geminiResponse = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: `Translate the following text to ${targetLang}. Output ONLY the translated text.\n\nText: ${text}`,
              },
            ],
          },
        ],
        generationConfig: { temperature: 0.1 },
      }),
    });

    if (!geminiResponse.ok) {
      const err = await geminiResponse.text();
      logError('ECHO', `Service error: ${geminiResponse.status}`);
      return NextResponse.json(
        {
          error: STATUS_MESSAGES.ERROR,
          message: 'Eburon AI encountered an issue. Please try again.',
        },
        { status: geminiResponse.status >= 500 ? 503 : 400 },
      );
    }

    const data = await geminiResponse.json();
    const translation = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';

    logInfo('ECHO', STATUS_MESSAGES.COMPLETE);
    return NextResponse.json({ translation });
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
