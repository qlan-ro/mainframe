/**
 * Shiki-based syntax highlighter for code blocks in the markdown renderer.
 *
 * Fits the `SyntaxHighlighterProps` slot from @assistant-ui/react-markdown so
 * it can be passed as `SyntaxHighlighter` in the markdownComponents map.
 *
 * Token-rendering logic lives in `@/lib/shiki-tokens` (shared with the editor
 * MarkdownPreview).
 */
import type { FC } from 'react';
import type { SyntaxHighlighterProps } from '@assistant-ui/react-markdown';
import { cn } from '@/lib/utils';
import { ShikiCode } from '@/lib/shiki-tokens';
import { useInstructionChipForLine } from '../smart-actions/use-instruction-chip';

const PRE_CLASS = cn(
  'bg-mf-code-bg text-mf-code-fg overflow-x-auto p-3 mt-0 mb-3',
  'border border-t-0 border-border rounded-b-md font-mono text-xs leading-5',
);

export const SyntaxHighlighter: FC<SyntaxHighlighterProps> = ({ code, language }) => {
  // A single-instruction fence renders as the block chip that CodeHeader emits;
  // highlighting the same line underneath it would print it twice.
  const chip = useInstructionChipForLine(code);
  if (chip) return null;

  return <ShikiCode code={code} lang={language} preClass={PRE_CLASS} showLineNumbers />;
};

SyntaxHighlighter.displayName = 'SyntaxHighlighter';
