/**
 * Markdown renderer for assistant text parts.
 *
 * Wires MarkdownTextPrimitive from @assistant-ui/react-markdown with:
 *   - remarkGfm: tables, strikethrough, task lists, footnotes
 *   - remarkAppLinks: bare app-protocol URLs → clickable links
 *   - urlTransform: extends default URL sanitiser to allow app schemes
 *   - markdownComponents: warm-chrome styled component overrides
 *   - SyntaxHighlighter slot: shiki-based token highlighter on mf-code-* tokens
 *   - CodeHeader slot: language label + copy button (data-testid chat-code-copy)
 *
 * Code-block layout follows the native single path:
 *   primitive detects fenced block → calls CodeHeader slot, then SyntaxHighlighter slot.
 * The `code` override here handles ONLY inline code (no language class).
 *
 * `MarkdownText` is the `TextMessagePartComponent` wired into AssistantMessage.
 * `markdownComponents` is exported separately so UserMessage can reuse it.
 */
import React, { memo, useState, useCallback, type FC } from 'react';
import type { TextMessagePartComponent } from '@assistant-ui/react';
import {
  MarkdownTextPrimitive,
  unstable_memoizeMarkdownComponents,
  useIsMarkdownCodeBlock,
} from '@assistant-ui/react-markdown';
import remarkGfm from 'remark-gfm';
import type { Pluggable } from 'unified';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem } from '@/components/ui/context-menu';
import { useHost } from '@/lib/host';
import { urlTransform, remarkAppLinks } from './markdown-url-transform';
import { SyntaxHighlighter } from './syntax-highlight';
import { CodeHeader } from './CodeHeader';

// ── Inline code ───────────────────────────────────────────────────────────────
// Handles only inline `code` spans. Fenced code blocks are handled by the
// native CodeHeader + SyntaxHighlighter slots (registered at the bottom of
// markdownComponents); those slots are always called for block-level code.

function Code({ className, children, ...props }: React.ComponentProps<'code'>) {
  const isCodeBlock = useIsMarkdownCodeBlock();

  if (isCodeBlock) {
    // The primitive owns the block layout — just pass through so CodeHeader and
    // SyntaxHighlighter slots receive the fully-assembled pre+code children.
    return (
      <code className={className} {...props}>
        {children}
      </code>
    );
  }

  return (
    <code
      className={cn(
        'aui-md-inline-code',
        'bg-mf-code-bg text-mf-code-fg',
        'rounded-sm border border-border px-1.5 py-0.5',
        'font-mono text-caption',
        className,
      )}
      {...props}
    >
      {children}
    </code>
  );
}

// ── Table components ─────────────────────────────────────────────────────────

function MarkdownTable({ children, ...props }: React.ComponentProps<'table'>) {
  return (
    <div className="rounded-md border border-border overflow-hidden my-3">
      <table className="w-full border-collapse text-body" {...props}>
        {children}
      </table>
    </div>
  );
}

function MarkdownThead({ children, ...props }: React.ComponentProps<'thead'>) {
  return (
    <thead className="bg-mf-content2" {...props}>
      {children}
    </thead>
  );
}

function MarkdownTh({ children, ...props }: React.ComponentProps<'th'>) {
  return (
    <th className="font-sans text-label font-bold text-muted-foreground px-3 py-2 text-left" {...props}>
      {children}
    </th>
  );
}

function MarkdownTd({ children, ...props }: React.ComponentProps<'td'>) {
  return (
    <td className="font-sans text-label text-foreground px-3 py-2 border-t border-border" {...props}>
      {children}
    </td>
  );
}

function MarkdownTr({ children, ...props }: React.ComponentProps<'tr'>) {
  return (
    <tr className="even:bg-mf-content2" {...props}>
      {children}
    </tr>
  );
}

// ── Link with URL tooltip ─────────────────────────────────────────────────────

/** Writes `href` to clipboard and briefly shows "Copied" feedback. */
function useCopyHref(href: string | undefined) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(
    (e?: React.MouseEvent) => {
      e?.preventDefault();
      e?.stopPropagation();
      if (!href) return;
      navigator.clipboard.writeText(href).then(
        () => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        },
        () => {
          console.warn('[markdown-text] clipboard write failed');
        },
      );
    },
    [href],
  );
  return { copied, copy };
}

function LinkWithPreview({
  className,
  href,
  ...props
}: React.AnchorHTMLAttributes<HTMLAnchorElement>): React.ReactElement {
  const host = useHost();
  const { copied, copy } = useCopyHref(href);

  const handleOpen = useCallback(
    (e?: React.MouseEvent) => {
      if (!href) return;
      e?.preventDefault();
      host.shell.openExternal(href).catch(() => {
        console.warn('[markdown-text] openExternal failed', href);
      });
    },
    [href, host],
  );

  if (!href) {
    return <a className={cn('aui-md-a text-primary underline underline-offset-2', className)} {...props} />;
  }

  return (
    <Tooltip>
      <ContextMenu>
        <TooltipTrigger asChild>
          <ContextMenuTrigger asChild>
            <a
              className={cn(
                'aui-md-a text-primary underline underline-offset-2',
                'hover:opacity-80 transition-opacity cursor-pointer',
                className,
              )}
              href={href}
              onClick={handleOpen}
              {...props}
            />
          </ContextMenuTrigger>
        </TooltipTrigger>
        <ContextMenuContent>
          <ContextMenuItem data-testid="chat-link-copy" onClick={copy}>
            Copy link
          </ContextMenuItem>
          <ContextMenuItem data-testid="chat-link-open" onClick={handleOpen}>
            Open link
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      <TooltipContent className="flex items-center gap-1.5 max-w-[400px]">
        <span className="truncate min-w-0">{href}</span>
        <button
          data-testid="chat-link-copy-url"
          type="button"
          onClick={copy}
          className={cn(
            'shrink-0 px-1.5 py-0.5 rounded-sm',
            'bg-accent hover:bg-muted text-muted-foreground hover:text-foreground',
            'transition-colors text-micro',
          )}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </TooltipContent>
    </Tooltip>
  );
}

// ── Component map ─────────────────────────────────────────────────────────────

export const markdownComponents = unstable_memoizeMarkdownComponents({
  h1: ({ className, ...props }) => (
    <h1 className={cn('aui-md-h1 text-title font-bold mt-4 mb-2 first:mt-0', className)} {...props} />
  ),
  h2: ({ className, ...props }) => (
    <h2 className={cn('aui-md-h2 text-heading font-bold mt-3 mb-1.5 first:mt-0', className)} {...props} />
  ),
  h3: ({ className, ...props }) => (
    <h3 className={cn('aui-md-h3 text-body font-bold mt-2.5 mb-1 first:mt-0', className)} {...props} />
  ),
  h4: ({ className, ...props }) => (
    <h4 className={cn('aui-md-h4 text-body font-semibold mt-2 mb-1 first:mt-0', className)} {...props} />
  ),
  p: ({ className, ...props }) => (
    <p className={cn('aui-md-p my-2.5 leading-relaxed first:mt-0 last:mb-0', className)} {...props} />
  ),
  a: LinkWithPreview as FC<React.AnchorHTMLAttributes<HTMLAnchorElement>>,
  blockquote: ({ className, ...props }) => (
    <blockquote
      className={cn(
        'aui-md-blockquote border-s-[3px] border-primary/40 text-muted-foreground',
        'my-2.5 ps-3 italic',
        className,
      )}
      {...props}
    />
  ),
  ul: ({ className, ...props }) => (
    <ul
      className={cn('aui-md-ul marker:text-muted-foreground my-2 ms-4 list-disc [&>li]:mt-1', className)}
      {...props}
    />
  ),
  ol: ({ className, ...props }) => (
    <ol
      className={cn('aui-md-ol marker:text-muted-foreground my-2 ms-4 list-decimal [&>li]:mt-1', className)}
      {...props}
    />
  ),
  li: ({ className, ...props }) => <li className={cn('aui-md-li leading-relaxed', className)} {...props} />,
  hr: ({ className, ...props }) => <hr className={cn('aui-md-hr border-border my-0.5', className)} {...props} />,
  table: MarkdownTable,
  thead: MarkdownThead,
  th: MarkdownTh,
  td: MarkdownTd,
  tr: MarkdownTr,
  strong: ({ className, ...props }) => <strong className={cn('aui-md-strong font-semibold', className)} {...props} />,
  del: ({ className, ...props }) => (
    <del className={cn('aui-md-del line-through text-muted-foreground', className)} {...props} />
  ),
  // pre is rendered inside the primitive's block layout — suppress the default wrapper
  pre: ({ children }) => <>{children}</>,
  // code handles only inline spans; the primitive routes fenced blocks to
  // the CodeHeader + SyntaxHighlighter slots below.
  code: Code,
  // Fenced code-block slots: primitive calls CodeHeader first, then SyntaxHighlighter.
  // Together they render the header bar + shiki-highlighted <pre> exactly once.
  SyntaxHighlighter,
  CodeHeader,
});

// ── remark plugin set (stable reference — must not be defined inline) ─────────

const REMARK_PLUGINS: Pluggable[] = [remarkGfm, remarkAppLinks];

// ── MarkdownText: TextMessagePartComponent ────────────────────────────────────

const MarkdownTextImpl: TextMessagePartComponent = () => {
  // `data-text-part` marks the searchable text container for in-chat Find
  // (FindBar walks [data-message-id] → [data-text-part]). The wrapper guarantees
  // the attribute lands on a real DOM node regardless of primitive prop-forwarding.
  return (
    <div data-text-part>
      <MarkdownTextPrimitive
        className="aui-md"
        remarkPlugins={REMARK_PLUGINS}
        urlTransform={urlTransform}
        components={markdownComponents}
      />
    </div>
  );
};

export const MarkdownText: TextMessagePartComponent = memo(MarkdownTextImpl);
MarkdownText.displayName = 'MarkdownText';
