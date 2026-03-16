import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  // Return local Whisper URL for client-side STT
  const whisperUrl = process.env.WHISPER_URL || 'http://localhost:7860';
  return NextResponse.json({ url: whisperUrl });
}
