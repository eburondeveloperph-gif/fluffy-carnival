'use client';

import { useEffect, useRef } from 'react';

interface TranslatorIframeProps {
  targetLanguage?: string;
}

export function TranslatorIframe({ targetLanguage = 'Spanish' }: TranslatorIframeProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        minHeight: '500px',
        border: 'none',
        overflow: 'hidden',
      }}
    >
      <iframe
        ref={iframeRef}
        src="/translator.html"
        style={{
          width: '100%',
          height: '100%',
          minHeight: '500px',
          border: 'none',
          overflow: 'hidden',
        }}
        title="Success Class Translator"
        allow="microphone; autoplay"
      />
    </div>
  );
}
