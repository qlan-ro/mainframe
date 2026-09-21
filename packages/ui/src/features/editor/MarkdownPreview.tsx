/**
 * MarkdownPreview — renders a markdown STRING as warm-chrome prose for the
 * editor's Preview mode. Uses react-markdown directly (the chat's
 * MarkdownTextPrimitive is bound to assistant-ui message parts and can't render
 * an arbitrary buffer).
 *
 * Code blocks use the shared shiki engine via `ShikiCode` from `@/lib/shiki-tokens`.
 * They render plain until the async highlighter resolves, then swap in colored
 * token spans — no layout jank because the pre/code wrapper dimensions are stable.
 *
 * The `notes` prop is optional: when a caller lifts a note set for this file
 * tab (see MarkdownEditorTab), each annotatable block (p, h1-h6, li, pre,
 * blockquote, table) gets the hover-revealed add-note affordance via
 * MarkdownAnnotatedBlock; absent, this renders exactly as before.
 */
import { useMemo, type ComponentPropsWithoutRef, type JSX } from 'react';
import Markdown from 'react-markdown';
import type { ExtraProps } from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import { useHost } from '@/lib/host';
import { urlTransform } from '@/features/chat/parts/markdown-url-transform';
import { ShikiCode } from '@/lib/shiki-tokens';
import { MarkdownAnnotatedBlock } from './MarkdownAnnotatedBlock';
import { MarkdownNotesProvider, type MarkdownNotesContextValue } from './markdown-notes-context';

type HastElement = NonNullable<ExtraProps['node']>;
type ElProps<T extends keyof JSX.IntrinsicElements> = ComponentPropsWithoutRef<T>;
type BlockProps<T extends keyof JSX.IntrinsicElements> = ElProps<T> & { node?: HastElement };

// ── Anchor ────────────────────────────────────────────────────────────────────

function Anchor({ href, children, ...props }: ElProps<'a'>) {
  const host = useHost();
  return (
    <a
      {...props}
      href={href}
      className="text-primary underline underline-offset-2"
      onClick={(e) => {
        if (!href) return;
        e.preventDefault();
        void host.shell.openExternal(href);
      }}
    >
      {children}
    </a>
  );
}

// ── Shiki code block ──────────────────────────────────────────────────────────

interface CodeBlockProps {
  className?: string;
  children?: React.ReactNode;
}

const CODE_PRE_CLASS =
  'my-2 overflow-x-auto rounded-md border border-border bg-mf-code-bg p-3 font-mono text-xs text-mf-code-fg';

/** Fenced code block with shiki highlighting. Renders plain until shiki resolves. */
function CodeBlock({ className, children }: CodeBlockProps) {
  const raw = String(children ?? '').replace(/\n$/, '');
  const langMatch = /language-(\w+)/.exec(className ?? '');
  const langHint = langMatch?.[1];

  return <ShikiCode code={raw} lang={langHint} preClass={CODE_PRE_CLASS} />;
}

// ── Component map ─────────────────────────────────────────────────────────────
// Warm-chrome prose overrides. Self-contained so the preview doesn't depend on
// the assistant-ui code-block hooks the chat's markdownComponents rely on.
// Annotatable elements (p, h1-h6, li, pre, blockquote, table) wrap their
// rendered tag in MarkdownAnnotatedBlock, which no-ops without a notes context.

const components = {
  a: Anchor,
  h1: ({ node, ...p }: BlockProps<'h1'>) => (
    <MarkdownAnnotatedBlock node={node}>
      <h1 {...p} className="mt-4 mb-2 text-base font-semibold text-foreground" />
    </MarkdownAnnotatedBlock>
  ),
  h2: ({ node, ...p }: BlockProps<'h2'>) => (
    <MarkdownAnnotatedBlock node={node}>
      <h2 {...p} className="mt-4 mb-2 text-base font-semibold text-foreground" />
    </MarkdownAnnotatedBlock>
  ),
  h3: ({ node, ...p }: BlockProps<'h3'>) => (
    <MarkdownAnnotatedBlock node={node}>
      <h3 {...p} className="mt-3 mb-1.5 text-sm font-semibold text-foreground" />
    </MarkdownAnnotatedBlock>
  ),
  h4: ({ node, ...p }: BlockProps<'h4'>) => (
    <MarkdownAnnotatedBlock node={node}>
      <h4 {...p} className="mt-3 mb-1.5 text-sm font-semibold text-foreground" />
    </MarkdownAnnotatedBlock>
  ),
  h5: ({ node, ...p }: BlockProps<'h5'>) => (
    <MarkdownAnnotatedBlock node={node}>
      <h5 {...p} className="mt-2 mb-1 text-xs font-semibold text-foreground" />
    </MarkdownAnnotatedBlock>
  ),
  h6: ({ node, ...p }: BlockProps<'h6'>) => (
    <MarkdownAnnotatedBlock node={node}>
      <h6 {...p} className="mt-2 mb-1 text-xs font-semibold text-foreground" />
    </MarkdownAnnotatedBlock>
  ),
  p: ({ node, ...p }: BlockProps<'p'>) => (
    <MarkdownAnnotatedBlock node={node}>
      <p {...p} className="my-2 text-sm leading-relaxed text-foreground" />
    </MarkdownAnnotatedBlock>
  ),
  ul: (p: ElProps<'ul'>) => <ul {...p} className="my-2 ml-5 list-disc text-sm text-foreground" />,
  ol: (p: ElProps<'ol'>) => <ol {...p} className="my-2 ml-5 list-decimal text-sm text-foreground" />,
  li: ({ node, ...p }: BlockProps<'li'>) => (
    <MarkdownAnnotatedBlock node={node}>
      <li {...p} className="my-0.5" />
    </MarkdownAnnotatedBlock>
  ),
  blockquote: ({ node, ...p }: BlockProps<'blockquote'>) => (
    <MarkdownAnnotatedBlock node={node}>
      <blockquote {...p} className="my-2 border-l-[3px] border-primary/40 pl-3 text-sm text-muted-foreground" />
    </MarkdownAnnotatedBlock>
  ),
  code: ({ className, children, ...props }: ElProps<'code'>) => {
    // Fenced code blocks carry a language-* class; inline code does not.
    if (className?.startsWith('language-')) {
      return <CodeBlock className={className}>{children}</CodeBlock>;
    }
    return (
      <code
        {...props}
        className="rounded-sm border border-border bg-muted px-1.5 py-0.5 font-mono text-xs text-mf-code-cmt"
      >
        {children}
      </code>
    );
  },
  // Suppress the default pre wrapper — CodeBlock renders its own <pre>; this
  // one only carries the fence's source position (fact: mdast-util-to-hast
  // patches position onto both the code node and its pre wrapper).
  pre: ({ node, children }: BlockProps<'pre'>) => (
    <MarkdownAnnotatedBlock node={node}>{children}</MarkdownAnnotatedBlock>
  ),
  table: ({ node, ...p }: BlockProps<'table'>) => (
    <MarkdownAnnotatedBlock node={node}>
      <div className="my-2 overflow-x-auto">
        <table {...p} className="w-full border-collapse text-sm" />
      </div>
    </MarkdownAnnotatedBlock>
  ),
  th: (p: ElProps<'th'>) => (
    <th
      {...p}
      className="border border-border bg-muted px-[12px] py-[7px] text-left font-semibold text-muted-foreground"
    />
  ),
  td: (p: ElProps<'td'>) => (
    <td {...p} className="border border-border px-[12px] py-[7px] even:bg-muted odd:bg-background" />
  ),
  hr: (p: ElProps<'hr'>) => <hr {...p} className="my-4 border-border" />,
};

// ── MarkdownPreview ───────────────────────────────────────────────────────────

interface MarkdownPreviewProps {
  value: string;
  /** Lifted note-set wiring; absent renders exactly as before (no annotation affordance). */
  notes?: Omit<MarkdownNotesContextValue, 'source'>;
}

export function MarkdownPreview({ value, notes }: MarkdownPreviewProps) {
  // The map is a module constant; only the <Markdown> element itself needs
  // memoizing so an unrelated re-render (e.g. a draft keystroke) doesn't give
  // every block a new component identity and remount an open note's widget.
  const markdownElement = useMemo(
    () => (
      <Markdown remarkPlugins={[remarkGfm, remarkBreaks]} urlTransform={urlTransform} components={components}>
        {value}
      </Markdown>
    ),
    [value],
  );
  const notesContextValue: MarkdownNotesContextValue | null = notes ? { source: value, ...notes } : null;

  return (
    <div data-testid="markdown-preview" className="mf-editor-selectable h-full overflow-auto">
      <div className="mx-auto max-w-[720px] px-10 pb-16 pt-[36px]">
        <MarkdownNotesProvider value={notesContextValue}>{markdownElement}</MarkdownNotesProvider>
      </div>
    </div>
  );
}
