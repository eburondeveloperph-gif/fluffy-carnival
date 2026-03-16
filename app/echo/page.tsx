'use client';

import React from 'react';
import { EchoTranslator } from '@/lib/orbit/components/EchoTranslator';

/**
 * Echo Translator Page
 *
 * Simplified UI:
 * - MIC button: Enable transcription (uses selected language for STT)
 * - SPEAKER button: Enable translation (suppress original audio, play TTS)
 * - LANGUAGE dropdown: Select language for both STT and translation output
 */
export default function EchoPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex flex-col items-center justify-center p-4">
      {/* Header */}
      <div className="text-center mb-8">
        <div className="flex items-center justify-center gap-3 mb-4">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center">
            <svg
              className="w-6 h-6 text-white"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2 2 2 0 012 2v.142a2.058 2.058 0 003.96.674l1.628-3.286m0 0L17.5 9.5m-1.414 1.414L17.5 9.5m1.414 1.414L17.5 9.5m1.414 1.414L19.328 8M13 20H9a2 2 0 01-2-2v-2a2 2 0 01-2-2V9a2 2 0 012-2h6a2 2 0 012 2v2.5"
              />
            </svg>
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">Echo</h1>
            <p className="text-sm text-slate-400">Real-time Speech Translation</p>
          </div>
        </div>
        <p className="text-slate-500 max-w-md mx-auto">
          Click <strong>MIC</strong> to start transcribing in your selected language. Click{' '}
          <strong>SPEAKER</strong> to enable translation.
        </p>
      </div>

      {/* Echo Translator Component */}
      <EchoTranslator className="w-full max-w-md" />

      {/* Instructions */}
      <div className="mt-8 max-w-md w-full">
        <div className="bg-slate-800/50 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-white mb-3">How to use</h3>
          <ul className="text-xs text-slate-400 space-y-2">
            <li className="flex gap-2">
              <span className="text-emerald-400">1.</span>
              <span>Select your language from the dropdown (used for STT)</span>
            </li>
            <li className="flex gap-2">
              <span className="text-emerald-400">2.</span>
              <span>Click MIC to start transcription</span>
            </li>
            <li className="flex gap-2">
              <span className="text-emerald-400">3.</span>
              <span>Click SPEAKER to enable translation (suppresses original audio)</span>
            </li>
            <li className="flex gap-2">
              <span className="text-emerald-400">4.</span>
              <span>Speak in your selected language</span>
            </li>
          </ul>
        </div>
      </div>

      {/* Footer */}
      <div className="mt-8 text-center">
        <p className="text-xs text-slate-600">
          Single model: <span className="text-emerald-500">Echo v2.5</span>
        </p>
      </div>
    </div>
  );
}
