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

const PRE_CLASS = cn(
  'bg-mf-code-bg text-mf-code-fg overflow-x-auto p-3 mt-0 mb-3',
  'border border-t-0 border-border rounded-b-md font-mono text-label leading-5',
);

export const SyntaxHighlighter: FC<SyntaxHighlighterProps> = ({ code, language }) => (
  <ShikiCode code={code} lang={language} preClass={PRE_CLASS} showLineNumbers />
);

SyntaxHighlighter.displayName = 'SyntaxHighlighter';
