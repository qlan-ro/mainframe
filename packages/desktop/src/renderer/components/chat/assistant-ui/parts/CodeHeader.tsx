import React, { useState, useCallback } from 'react';
import { Copy, Check } from 'lucide-react';

interface CodeHeaderProps {
  language: string | undefined;
  code: string;
}

export function CodeHeader({ language, code }: CodeHeaderProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [code]);

  return (
    <div className="group flex items-center justify-between px-3 py-1.5 bg-mf-hover/50 border-b border-mf-divider">
      <span className="text-mf-small font-mono text-mf-text-secondary">
        {language && language !== 'unknown' ? language : 'text'}
      </span>
      <button
        onClick={handleCopy}
        className="flex items-center gap-1 text-mf-small text-mf-text-secondary hover:text-mf-text-primary opacity-0 group-hover:opacity-100 transition-opacity"
      >
        {copied ? (
          <>
            <Check size={14} className="text-mf-success" />
            <span>Copied</span>
          </>
        ) : (
          <>
            <Copy size={14} />
            <span>Copy</span>
          </>
        )}
      </button>
    </div>
  );
}
