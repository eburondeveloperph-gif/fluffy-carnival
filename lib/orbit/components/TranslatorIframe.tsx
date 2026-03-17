'use client';

interface TranslatorIframeProps {
  targetLanguage?: string;
}

export function TranslatorIframe({ targetLanguage = 'Spanish' }: TranslatorIframeProps) {
  const iframeSrc = `/translator.html?targetLanguage=${encodeURIComponent(targetLanguage)}`;

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
        src={iframeSrc}
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
