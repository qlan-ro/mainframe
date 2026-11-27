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
// A plain block has no gutter; this pads its text to where the numbered one starts it (the
// px-3 inset, the 22 px number column, the gap-x-5), so a fence that grows past the size limit
// while streaming does not shift its text sideways.
const PLAIN_BODY = 'pl-13.5';
const LINE =
  '-mx-3 px-3 in-data-numbered:gap-x-5 before:min-w-[22px] before:font-mono before:text-xs before:text-muted-foreground/50';

/**
 * Past either limit a block is plain text: one text node in the Code Block, with
 * no per-line numbering and no highlighting. Typical pasted code and logs sit
 * well below them (500 lines is a few dozen KB at most; a numbered, highlighted
 * block that size is a few thousand elements and a few tens of ms of shiki), while
 * a 20k-line log would be 20k grid rows plus a synchronous tokenization on the
 * main thread. The byte limit catches a minified one-liner the line limit misses.
 */
export const PLAIN_CODE_MAX_LINES = 500;
export const PLAIN_CODE_MAX_CHARS = 50_000;

export function isLargeCode(code: string): boolean {
  if (code.length > PLAIN_CODE_MAX_CHARS) return true;
  let lines = 1;
  for (let i = code.indexOf('\n'); i !== -1; i = code.indexOf('\n', i + 1)) {
    if (++lines > PLAIN_CODE_MAX_LINES) return true;
  }
  return false;
}

export function MarkdownCodeBlock({ code, language }: { code: string; language?: string }) {
  const large = isLargeCode(code);
  // No language for a large block: the hook then never loads or runs shiki.
  const lines = useShikiTokens(code, large ? undefined : language);
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
      {large ? (
        <CodeBlockContent className={cn(BODY, PLAIN_BODY)} data-plain>
          {code}
        </CodeBlockContent>
      ) : (
        <CodeBlockContent lineNumbers className={BODY}>
          {body.map((line, i) => (
            <CodeBlockLine key={i} className={LINE}>
              {line}
            </CodeBlockLine>
          ))}
        </CodeBlockContent>
      )}
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
