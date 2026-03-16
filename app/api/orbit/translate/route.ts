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

function handleAudioMessage(message: LiveServerMessage): string | null {
  const parts = message.serverContent?.modelTurn?.parts;
  if (!parts || parts.length === 0) return null;

  for (const part of parts) {
    if (part.text) return part.text;
    if (part.inlineData) {
      return `[audio:${part.inlineData.mimeType}]`;
    }
  }
  return null;
}

export async function POST(request: Request) {
  try {
    const { text, targetLang, mode = 'translate' } = await request.json();

    if (!text && mode === 'translate') {
      return NextResponse.json({ error: 'Missing text parameter' }, { status: 400 });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'GEMINI_API_KEY not configured' }, { status: 500 });
    }

    if (!ai) {
      ai = new GoogleGenAI({ apiKey });
    }

    const model = 'gemini-2.0-flash-live-001';

    if (mode === 'tts') {
      // Generate audio response
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
              prebuiltVoiceConfig: { voiceName: 'Kore' },
            },
          },
        },
      });

      session.sendClientContent({ turns: [text] });

      const audioChunks: string[] = [];
      let done = false;
      let fullText = '';

      while (!done) {
        const msg = await waitForMessage();
        const part = msg.serverContent?.modelTurn?.parts?.[0];

        if (part?.text) fullText += part.text;
        if (part?.inlineData?.data) audioChunks.push(part.inlineData.data);
        if (msg.serverContent?.turnComplete) done = true;
      }

      session.close();
      session = null;
      responseQueue = [];

      return NextResponse.json({
        translation: fullText,
        audioChunks,
      });
    }

    // Translation mode
    const langMap: Record<string, string> = {
      'Tagalog-English mix (Taglish)': 'Filipino',
      Spanish: 'Spanish',
      French: 'French',
      German: 'German',
      Japanese: 'Japanese',
      Chinese: 'Chinese',
      Korean: 'Korean',
      Dutch: 'Dutch',
      English: 'English',
    };
    const targetLanguage = langMap[targetLang] || 'English';

    session = await ai.live.connect({
      model,
      callbacks: {
        onopen: () => {},
        onmessage: (msg: LiveServerMessage) => responseQueue.push(msg),
        onerror: (e: any) => console.error('Error:', e),
        onclose: () => {},
      },
      config: {
        responseModalities: [Modality.TEXT],
      },
    });

    const prompt = `Translate the following text to ${targetLanguage}. Output ONLY the translated text:\n\n${text}`;
    session.sendClientContent({ turns: [prompt] });

    let translation = '';
    let done = false;
    const audioChunks: string[] = [];

    while (!done) {
      const msg = await waitForMessage();
      const part = msg.serverContent?.modelTurn?.parts?.[0];

      if (part?.text) translation += part.text;
      if (part?.inlineData?.data) audioChunks.push(part.inlineData.data);
      if (msg.serverContent?.turnComplete) done = true;
    }

    session.close();
    session = null;
    responseQueue = [];

    return NextResponse.json({
      translation: translation.trim(),
      audioChunks,
    });
  } catch (error) {
    console.error('Gemini Live error:', error);
    return NextResponse.json({ error: 'Service unavailable' }, { status: 500 });
  }
}
