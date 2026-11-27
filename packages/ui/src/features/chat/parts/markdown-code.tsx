/**
 * Code in markdown: fenced blocks through shadcn's Code Block, inline spans as
 * the transcript's code chip. A fence or span whose whole content is one known
 * `/instruction` renders as its instruction chip instead.
 *
 * The parser hands a fence to `pre` with the rendered `code` element as its only
 * child, so `MarkdownPre` reads the language and text from that child and never
 * renders it. `code` is therefore only ever reached for inline spans.
 */
import { isValidElement, type ComponentProps, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { useShikiTokens, TokenSpans } from '@/lib/shiki-tokens';
import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockContent,
  CodeBlockCopyButton,
  CodeBlockHeader,
  CodeBlockLine,
  CodeBlockTitle,
} from '@/components/ui/code-block';
import { InstructionChip } from '../smart-actions/InstructionChip';
import { useInstructionChipForLine } from '../smart-actions/use-instruction-chip';

function textOf(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  return '';
}

function languageOf(className: unknown): string | undefined {
  return typeof className === 'string' ? /language-(\S+)/.exec(className)?.[1] : undefined;
}

/** The label the header shows: the fence's language as written, or "text". */
function displayLanguage(language: string | undefined): string {
  return language && language !== 'unknown' && language !== 'text' ? language : 'text';
}

// The look the transcript's code blocks had before Code Block: a 30 px header
// (29 px plus the frame's top hairline) over a tinted, numbered body, both
// inside one hairline frame.
const FRAME = 'my-3 border-border text-foreground dark:bg-transparent';
const HEADER = 'mf-tr-meta h-[29px] justify-between border-b border-border pt-0 pr-1.5 pl-3 select-none';
const TITLE = 'mf-tr-meta font-normal text-muted-foreground';
const COPY =
  "h-6 gap-1 rounded-md border-0 px-1.5 mf-tr-meta font-medium transition-colors hover:bg-accent hover:text-foreground focus-visible:focus-line-inset data-copied:text-mf-tr-ok [&_svg:not([class*='size-'])]:size-3";
const BODY = 'mf-tr-mono bg-mf-tr-code px-3 py-2.5 group-has-data-[slot=code-block-header]/code-block:pt-2.5';
const LINE =
  '-mx-3 px-3 in-data-numbered:gap-x-5 before:min-w-[22px] before:font-mono before:text-xs before:text-muted-foreground/50';

export function MarkdownCodeBlock({ code, language }: { code: string; language?: string }) {
  const lines = useShikiTokens(code, language);
  // An empty line stays '' so Code Block gives it the newline a copied selection keeps.
  const body = lines
    ? lines.map((tokens) => (tokens.some((t) => t.content) ? <TokenSpans tokens={tokens} /> : ''))
    : code.split('\n');
  return (
    <CodeBlock className={FRAME} data-testid="chat-code-block">
      <CodeBlockHeader className={HEADER}>
        <CodeBlockTitle className={TITLE}>{displayLanguage(language)}</CodeBlockTitle>
        <CodeBlockActions className="my-0 me-0">
          <CodeBlockCopyButton value={code} label size="xs" className={COPY} data-testid="chat-code-copy" />
        </CodeBlockActions>
      </CodeBlockHeader>
      <CodeBlockContent lineNumbers className={BODY}>
        {body.map((line, i) => (
          <CodeBlockLine key={i} className={LINE}>
            {line}
          </CodeBlockLine>
        ))}
      </CodeBlockContent>
    </CodeBlock>
  );
}

export function MarkdownPre({ children }: ComponentProps<'pre'>) {
  const child = isValidElement<{ className?: unknown; children?: ReactNode }>(children) ? children : null;
  // The parser ends a fence's text with its closing newline; it is no line of code.
  const code = textOf(child?.props.children).replace(/\n$/, '');
  const chip = useInstructionChipForLine(code);
  if (!child) return <pre>{children}</pre>;
  if (chip) return <InstructionChip target={chip} variant="block" />;
  return <MarkdownCodeBlock code={code} language={languageOf(child.props.className)} />;
}

export function MarkdownInlineCode({ className, children, ...props }: ComponentProps<'code'>) {
  const chip = useInstructionChipForLine(children);
  if (chip) return <InstructionChip target={chip} />;
  return (
    <code
      className={cn(
        'aui-md-inline-code mf-tr-code rounded-[5px] bg-mf-tr-code px-[5px] py-px font-mono text-foreground',
        className,
      )}
      {...props}
    >
      {children}
    </code>
  );
}
