import { GoogleGenAI, Modality, Type, LiveServerMessage, MediaResolution } from '@google/genai';
import { TranslationResult, EmotionType } from '../types';
import {
  sanitizeErrorMessage,
  logInfo,
  logError,
  logWarn,
  getModelId,
  STATUS_MESSAGES,
  SERVICE_ALIASES,
} from '../config/serviceAliases';

// Server-side only: Initialize with environment variable
const ai = new GoogleGenAI({ apiKey: process.env.NEXT_PUBLIC_GEMINI_API_KEY || '' });

// Get whitelisted model IDs (server-side only)
const STT_MODEL = getModelId('STT_LIVE_AUDIO');
const TRANSLATION_MODEL = getModelId('TRANSLATION_LLM');

// Retry configuration
const MAX_RETRIES = 3;
const RETRY_DELAY = 2000;

/**
 * Translate text using Eburon AI
 * (Public-facing alias for translation service)
 */
export async function translateWithEburon(text: string, targetLang: string): Promise<string> {
  try {
    logInfo('ECHO', `Translating to ${targetLang}...`);

    const res = await fetch('/api/orbit/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, targetLang }),
    });

    if (!res.ok) {
      logError('ECHO', `Translation failed: ${res.status}`);
      throw new Error(STATUS_MESSAGES.ERROR);
    }

    const data = await res.json();
    logInfo('ECHO', 'Translation complete');
    return data.translation || text;
  } catch (e) {
    logError('ECHO', e);
    return text;
  }
}

// alias for backward compatibility
export const translateWithOrbit = translateWithEburon;

/**
 * Decode base64 string to Uint8Array
 */
function decode(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

/**
 * Decode raw PCM audio data into an AudioBuffer
 */
async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number = 24000,
  numChannels: number = 1,
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

/**
 * Play TTS using Echo Voice (Cartesia)
 */
async function playEchoTTS(text: string, ctx: AudioContext): Promise<void> {
  try {
    logInfo('ECHO', 'Synthesizing speech...');

    const res = await fetch('/api/orbit/tts', {
      method: 'POST',
      body: JSON.stringify({ text, provider: 'echo' }),
      headers: { 'Content-Type': 'application/json' },
    });

    if (!res.ok) {
      logError('ECHO', `TTS failed: ${res.status}`);
      throw new Error(STATUS_MESSAGES.ERROR);
    }

    const buf = await res.arrayBuffer();
    const audioBuf = await ctx.decodeAudioData(buf);
    const source = ctx.createBufferSource();
    source.buffer = audioBuf;
    source.connect(ctx.destination);
    source.start();

    logInfo('ECHO', 'Playback started');
  } catch (e) {
    logError('ECHO', e);
  }
}

/**
 * Live Translation Stream with Retry Logic
 * Uses Echo STT and Eburon AI for translation
 */
export async function streamTranslation(
  sourceText: string,
  targetLangName: string,
  audioCtx: AudioContext,
  onAudioData: (data: Uint8Array) => void,
  onTranscript: (text: string) => void,
  onEnd: (finalText: string) => void,
  sourceLangCode: string = 'auto',
  retryCount: number = 0,
  ttsProvider: 'echo' | 'eburon' = 'eburon',
): Promise<void> {
  let nextStartTime = 0;
  let fullTranslation = '';

  try {
    logInfo('ECHO', STATUS_MESSAGES.INITIALIZING);

    const sessionPromise = ai.live.connect({
      model: `models/${STT_MODEL}`,
      config: {
        responseModalities: [ttsProvider === 'echo' ? Modality.TEXT : Modality.AUDIO],
        outputAudioTranscription: {},
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Orus' } },
        },
        mediaResolution: MediaResolution.MEDIA_RESOLUTION_MEDIUM,
        contextWindowCompression: {
          triggerTokens: '25600',
          slidingWindow: { targetTokens: '12800' },
        },
        systemInstruction: `You are Echo, a high-fidelity vocal synthesis engine. 
        Your goal is to speak the provided text in ${targetLangName} with extreme precision, aiming for native human speaker quality.
        
        CRITICAL PERFORMANCE SPECS:
        1. NATIVE PRONUNCIATION: Use precise phonetic articulation based on native-speaker oral references for ${targetLangName}.
        2. EMOTION SYNTHESIS: Deliver the text with natural emotion and prosody.
        3. INSTANT DELIVERY: Start the audio immediately.
        
        You are a seamless, high-performance vocal synthesis bridge.`,
      },
      callbacks: {
        onopen: () => {
          logInfo('ECHO', STATUS_MESSAGES.CONNECTION_READY);
          sessionPromise.then((s) =>
            s.sendClientContent({
              turns: [{ parts: [{ text: sourceText }] }],
            }),
          );
        },
        onmessage: async (message: LiveServerMessage) => {
          const parts = message.serverContent?.modelTurn?.parts;
          if (parts) {
            for (const part of parts) {
              if (part.inlineData?.data) {
                const rawData = decode(part.inlineData.data);
                onAudioData(rawData);

                nextStartTime = Math.max(nextStartTime, audioCtx.currentTime);
                const buffer = await decodeAudioData(rawData, audioCtx);
                const source = audioCtx.createBufferSource();
                source.buffer = buffer;
                source.connect(audioCtx.destination);

                source.start(nextStartTime);
                nextStartTime += buffer.duration;
              }
              if (part.text) {
                fullTranslation += part.text;
                onTranscript(fullTranslation);
              }
            }
          }

          if (message.serverContent?.outputTranscription) {
            fullTranslation += message.serverContent.outputTranscription.text;
            onTranscript(fullTranslation);
          }

          if (message.serverContent?.turnComplete) {
            if (ttsProvider === 'echo' && fullTranslation.trim()) {
              await playEchoTTS(fullTranslation, audioCtx);
            }

            const waitTime = Math.max(0, (nextStartTime - audioCtx.currentTime) * 1000);
            setTimeout(() => onEnd(fullTranslation), waitTime + 100);
            logInfo('ECHO', STATUS_MESSAGES.COMPLETE);
          }
        },
        onclose: () => {
          logInfo('ECHO', 'Session closed');
          onEnd(fullTranslation);
        },
        onerror: async (e: any) => {
          logWarn('ECHO', `Connection issue (attempt ${retryCount + 1}/${MAX_RETRIES + 1})`);

          const isServiceUnavailable = e?.message?.includes('unavailable') || e?.status === 503;

          if (isServiceUnavailable && retryCount < MAX_RETRIES) {
            const delay = RETRY_DELAY * Math.pow(2, retryCount);
            logInfo('ECHO', `Retrying in ${delay}ms...`);
            setTimeout(() => {
              streamTranslation(
                sourceText,
                targetLangName,
                audioCtx,
                onAudioData,
                onTranscript,
                onEnd,
                sourceLangCode,
                retryCount + 1,
                ttsProvider,
              );
            }, delay);
          } else {
            logError('ECHO', sanitizeErrorMessage(e));
            onEnd(fullTranslation);
          }
        },
      },
    });
  } catch (err) {
    logError('ECHO', sanitizeErrorMessage(err));
    onEnd('');
  }
}

/**
 * Starts Echo STT session for real-time transcription.
 * Public-facing: Uses Echo STT alias
 */
export async function startTranscriptionSession(
  onTranscript: (text: string) => void,
  onEnd: () => void,
  targetLangName: string = 'English',
) {
  let fullTranscript = '';

  try {
    logInfo('ECHO', STATUS_MESSAGES.INITIALIZING);

    const sessionPromise = ai.live.connect({
      model: `models/${STT_MODEL}`,
      config: {
        responseModalities: [Modality.TEXT],
        outputAudioTranscription: {},
        systemInstruction: `You are Echo, a high-fidelity real-time transcription engine. 
        Transcribe the incoming audio into ${targetLangName}. 
        Provide ONLY the transcript, no other commentary. 
        If the audio is in another language, translate it to ${targetLangName} in real-time.
        Focus on accuracy and speed.`,
      },
      callbacks: {
        onopen: () => {
          logInfo('ECHO', STATUS_MESSAGES.CONNECTION_READY);
        },
        onmessage: (message: LiveServerMessage) => {
          const parts = message.serverContent?.modelTurn?.parts;
          if (parts) {
            for (const part of parts) {
              if (part.text) {
                fullTranscript += part.text;
                onTranscript(part.text);
              }
            }
          }
          if (message.serverContent?.outputTranscription) {
            const text = message.serverContent.outputTranscription.text;
            if (text) onTranscript(text);
          }
        },
        onclose: () => {
          logInfo('ECHO', 'Session ended');
          onEnd();
        },
        onerror: (e) => {
          logError('ECHO', sanitizeErrorMessage(e));
          onEnd();
        },
      },
    });

    const session = await sessionPromise;

    return {
      sendAudio: (base64Audio: string) => {
        session.sendRealtimeInput({
          audio: {
            mimeType: 'audio/pcm;rate=16000',
            data: base64Audio,
          },
        });
      },
      stop: () => {
        try {
          session.close();
          logInfo('ECHO', 'Session stopped');
        } catch (e) {
          logWarn('ECHO', 'Session cleanup warning');
        }
      },
    };
  } catch (err) {
    logError('ECHO', sanitizeErrorMessage(err));
    throw new Error(STATUS_MESSAGES.ERROR);
  }
}

// Export alias functions with sanitized names for public use
export const startEchoSTTSession = startTranscriptionSession;
export const streamEburonTranslation = streamTranslation;
