'use client';

import React from 'react';
import { EchoTranslator } from '@/lib/orbit/components/EchoTranslator';

export default function EchoPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-4">
          <h1 className="text-xl font-bold text-white">Echo</h1>
          <p className="text-xs text-slate-400">Real-time Speech Translation</p>
        </div>
        <EchoTranslator className="w-full" />
      </div>
    </div>
  );
}
