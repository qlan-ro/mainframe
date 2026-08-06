/**
 * Code-block header bar — language label + copy button.
 * Sits above the syntax-highlighted <pre> inside every fenced code block.
 * Plugs into the `CodeHeader` slot of markdownComponents (CodeHeaderProps).
 */
import { useState, useCallback, type FC } from 'react';
import { Copy, Check } from 'lucide-react';
import type { CodeHeaderProps } from '@assistant-ui/react-markdown';
import { cn } from '@/lib/utils';
import { InstructionChip } from '../smart-actions/InstructionChip';
import { useInstructionChipForLine } from '../smart-actions/use-instruction-chip';

export const CodeHeader: FC<CodeHeaderProps> = ({ language, code }) => {
  const [copied, setCopied] = useState(false);
  const chip = useInstructionChipForLine(code);

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

  // Both fence flavors call this slot — it is the one seam that can emit the
  // block chip exactly once (the two body slots return null for it).
  if (chip) return <InstructionChip target={chip} variant="block" />;

  return (
    <div
      className={cn(
        'flex items-center justify-between',
        'mt-3 bg-muted border border-border rounded-t-md',
        'px-3 py-1.5',
      )}
    >
      <span className="font-mono text-xs uppercase tracking-wide text-muted-foreground">{displayLang}</span>

      <button
        data-testid="chat-code-copy"
        type="button"
        onClick={handleCopy}
        aria-label={copied ? 'Copied' : 'Copy code'}
        className={cn(
          'flex items-center gap-1 px-1.5 py-0.5 rounded-sm',
          'text-xs font-semibold text-muted-foreground',
          'transition-colors hover:text-foreground hover:bg-accent',
          'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
          copied && 'text-success',
        )}
      >
        {copied ? <Check size={13} className="text-success" /> : <Copy size={13} />}
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
};

CodeHeader.displayName = 'CodeHeader';
