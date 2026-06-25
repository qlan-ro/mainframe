/**
 * Code-block header bar — language label + copy button.
 * Sits above the syntax-highlighted <pre> inside every fenced code block.
 * Plugs into the `CodeHeader` slot of markdownComponents (CodeHeaderProps).
 */
import { useState, useCallback, type FC } from 'react';
import { Copy, Check } from 'lucide-react';
import type { CodeHeaderProps } from '@assistant-ui/react-markdown';
import { cn } from '@/lib/utils';

export const CodeHeader: FC<CodeHeaderProps> = ({ language, code }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    if (!code) return;
    navigator.clipboard.writeText(code).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      },
      () => {
        console.warn('[CodeHeader] clipboard write failed');
      },
    );
  }, [code]);

  const displayLang = language && language !== 'unknown' && language !== 'text' ? language : 'text';

  return (
    <div
      className={cn(
        'flex items-center justify-between',
        'mt-3 bg-mf-content2 border border-border rounded-t-md',
        'px-3 py-1.5',
      )}
    >
      <span className="text-caption font-mono text-muted-foreground lowercase">{displayLang}</span>

      <button
        data-testid="chat-code-copy"
        type="button"
        onClick={handleCopy}
        aria-label={copied ? 'Copied' : 'Copy code'}
        className={cn(
          'flex items-center gap-1 px-1.5 py-0.5 rounded-sm',
          'text-caption text-muted-foreground',
          'transition-colors hover:text-foreground hover:bg-accent',
          'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
        )}
      >
        {copied ? <Check size={13} className="text-mf-success" /> : <Copy size={13} />}
      </button>
    </div>
  );
};

CodeHeader.displayName = 'CodeHeader';
