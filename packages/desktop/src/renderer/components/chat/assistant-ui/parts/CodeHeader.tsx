import { useState, useCallback } from 'react';
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
    <div className="group flex items-center justify-between px-3 py-1.5">
      <span className="text-mf-small font-mono text-mf-text-secondary">
        {language && language !== 'unknown' ? language : 'text'}
      </span>
      <button
        type="button"
        onClick={handleCopy}
        aria-label={copied ? 'Copied' : 'Copy code'}
        className="flex items-center text-mf-text-secondary hover:text-mf-text-primary transition-colors"
      >
        {copied ? <Check size={14} className="text-mf-success" /> : <Copy size={14} />}
      </button>
    </div>
  );
}
