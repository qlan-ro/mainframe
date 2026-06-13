/**
 * MarkdownPreview — renders a markdown STRING as warm-chrome prose for the
 * editor's Preview mode. Uses react-markdown directly (the chat's
 * MarkdownTextPrimitive is bound to assistant-ui message parts and can't render
 * an arbitrary buffer).
 *
 * Code blocks use the shared shiki engine via `ShikiCode` from `@/lib/shiki-tokens`.
 * They render plain until the async highlighter resolves, then swap in colored
 * token spans — no layout jank because the pre/code wrapper dimensions are stable.
 */
import type { ComponentPropsWithoutRef, JSX } from 'react';
import Markdown from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import { openExternal } from '@/lib/tauri/bridge';
import { urlTransform } from '@/features/chat/parts/markdown-url-transform';
import { ShikiCode } from '@/lib/shiki-tokens';

type ElProps<T extends keyof JSX.IntrinsicElements> = ComponentPropsWithoutRef<T>;

// ── Anchor ────────────────────────────────────────────────────────────────────

function Anchor({ href, children, ...props }: ElProps<'a'>) {
  return (
    <a
      {...props}
      href={href}
      className="text-primary underline underline-offset-2"
      onClick={(e) => {
        if (!href) return;
        e.preventDefault();
        void openExternal(href);
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
  'my-2 overflow-x-auto rounded-md border border-border bg-mf-code-bg p-3 font-mono text-caption text-mf-code-fg';

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

const components = {
  a: Anchor,
  h1: (p: ElProps<'h1'>) => <h1 {...p} className="mt-4 mb-2 text-heading font-semibold text-foreground" />,
  h2: (p: ElProps<'h2'>) => <h2 {...p} className="mt-4 mb-2 text-heading font-semibold text-foreground" />,
  h3: (p: ElProps<'h3'>) => <h3 {...p} className="mt-3 mb-1.5 text-body font-semibold text-foreground" />,
  p: (p: ElProps<'p'>) => <p {...p} className="my-2 text-body leading-relaxed text-foreground" />,
  ul: (p: ElProps<'ul'>) => <ul {...p} className="my-2 ml-5 list-disc text-body text-foreground" />,
  ol: (p: ElProps<'ol'>) => <ol {...p} className="my-2 ml-5 list-decimal text-body text-foreground" />,
  li: (p: ElProps<'li'>) => <li {...p} className="my-0.5" />,
  blockquote: (p: ElProps<'blockquote'>) => (
    <blockquote {...p} className="my-2 border-l-2 border-border pl-3 text-body text-muted-foreground" />
  ),
  code: ({ className, children, ...props }: ElProps<'code'>) => {
    // Fenced code blocks carry a language-* class; inline code does not.
    if (className?.startsWith('language-')) {
      return <CodeBlock className={className}>{children}</CodeBlock>;
    }
    return (
      <code
        {...props}
        className="rounded-sm border border-border bg-mf-code-bg px-1.5 py-0.5 font-mono text-caption text-mf-code-fg"
      >
        {children}
      </code>
    );
  },
  // Suppress the default pre wrapper — CodeBlock renders its own.
  pre: ({ children }: ElProps<'pre'>) => <>{children}</>,
  table: (p: ElProps<'table'>) => (
    <div className="my-2 overflow-x-auto">
      <table {...p} className="w-full border-collapse text-body" />
    </div>
  ),
  th: (p: ElProps<'th'>) => <th {...p} className="border border-border px-2 py-1 text-left font-semibold" />,
  td: (p: ElProps<'td'>) => <td {...p} className="border border-border px-2 py-1" />,
  hr: (p: ElProps<'hr'>) => <hr {...p} className="my-4 border-border" />,
};

// ── MarkdownPreview ───────────────────────────────────────────────────────────

export function MarkdownPreview({ value }: { value: string }) {
  return (
    <div data-testid="markdown-preview" className="mf-editor-selectable h-full overflow-auto px-6 py-4">
      <Markdown remarkPlugins={[remarkGfm, remarkBreaks]} urlTransform={urlTransform} components={components}>
        {value}
      </Markdown>
    </div>
  );
}
