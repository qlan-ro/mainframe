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
      // select-none: a selection spanning the block must not copy the language label or "Copy".
      className="mf-tr-meta mt-3 flex h-7.5 items-center justify-between rounded-t-lg border border-border pr-1.5 pl-3 text-muted-foreground select-none"
    >
      <span>{displayLang}</span>

      <button
        data-testid="chat-code-copy"
        type="button"
        onClick={handleCopy}
        aria-label={copied ? 'Copied' : 'Copy code'}
        className={cn(
          'flex h-6 items-center gap-1 rounded-md px-1.5 font-medium',
          'transition-colors hover:bg-accent hover:text-foreground focus-visible:focus-line-inset',
          copied && 'text-mf-tr-ok',
        )}
      >
        {copied ? <Check size={12} /> : <Copy size={12} />}
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
};

CodeHeader.displayName = 'CodeHeader';
