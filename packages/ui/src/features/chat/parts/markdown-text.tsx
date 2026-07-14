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
 *   - markdown-lists.tsx: ul/ol/li markers + task-list checkbox visual
 *   - markdown-table.tsx: table/thead/th/td/tr components
 *
 * Code-block layout follows the native single path:
 *   primitive detects fenced block → calls CodeHeader slot, then SyntaxHighlighter slot.
 * The `code` override here handles ONLY inline code (no language class).
 *
 * `MarkdownText` is the `TextMessagePartComponent` wired into AssistantMessage.
 * `markdownComponents` is exported separately so UserMessage can reuse it.
 */
import React, { memo, useState, useCallback, useEffect, useRef, type FC } from 'react';
import type { TextMessagePartComponent } from '@assistant-ui/react';
import {
  MarkdownTextPrimitive,
  unstable_memoizeMarkdownComponents,
  useIsMarkdownCodeBlock,
} from '@assistant-ui/react-markdown';
import remarkGfm from 'remark-gfm';
import type { Pluggable } from 'unified';
import { Check, Copy } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem } from '@/components/ui/context-menu';
import { useHost } from '@/lib/host';
import { urlTransform, remarkAppLinks } from './markdown-url-transform';
import { SyntaxHighlighter } from './syntax-highlight';
import { CodeHeader } from './CodeHeader';
import { MarkdownUl, MarkdownOl, MarkdownLi, MarkdownTaskCheckbox } from './markdown-lists';
import { MarkdownTable, MarkdownThead, MarkdownTh, MarkdownTd, MarkdownTr } from './markdown-table';

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
        // Dedicated warm-brown inline-code fg token (design #7a4d2a light);
        // distinct from the fenced-code-block `mf-code-fg` token.
        'bg-mf-raised text-mf-code-inline-fg',
        'rounded-xs border border-border px-1.5 py-0.5',
        'font-mono text-label',
        className,
      )}
      {...props}
    >
      {children}
    </code>
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

  // Radix closes a ContextMenuItem's menu immediately on select. The item
  // must preventDefault that default, show "Copied" feedback in place, then
  // close itself on a short delay (mirrors CodeHeader's inline copy pattern).
  const [menuCopied, setMenuCopied] = useState(false);
  const closeTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // ContextMenu's root open state is uncontrolled — Radix's ContextMenu.Root
  // takes no `open` prop, only `onOpenChange` as an observer — so there is no
  // prop that closes it programmatically. Escape is the one DOM signal its
  // DismissableLayer treats as a dismiss request.
  const closeMenu = useCallback(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  }, []);

  const handleMenuOpenChange = useCallback((open: boolean) => {
    if (!open) {
      clearTimeout(closeTimeoutRef.current);
      setMenuCopied(false);
    }
  }, []);

  useEffect(() => () => clearTimeout(closeTimeoutRef.current), []);

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

  const handleMenuCopy = useCallback(
    (e: Event) => {
      e.preventDefault();
      copy();
      setMenuCopied(true);
      clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = setTimeout(closeMenu, 900);
    },
    [copy, closeMenu],
  );

  // Design: a faint border-bottom rule (not a solid text-decoration underline).
  const LINK_RULE_CLASS = 'aui-md-a text-primary no-underline border-b border-primary/40';

  if (!href) {
    return <a className={cn(LINK_RULE_CLASS, className)} {...props} />;
  }

  return (
    <Tooltip>
      <ContextMenu onOpenChange={handleMenuOpenChange}>
        <TooltipTrigger asChild>
          <ContextMenuTrigger asChild>
            <a
              className={cn(LINK_RULE_CLASS, 'hover:opacity-80 transition-opacity cursor-pointer', className)}
              href={href}
              onClick={handleOpen}
              {...props}
            />
          </ContextMenuTrigger>
        </TooltipTrigger>
        <ContextMenuContent>
          <ContextMenuItem data-testid="chat-link-copy" onSelect={handleMenuCopy}>
            {menuCopied ? <Check className="mr-2 size-3.5 text-mf-success" /> : <Copy className="mr-2 size-3.5" />}
            {menuCopied ? 'Copied' : 'Copy link'}
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
            'transition-colors text-caption',
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
  // Design: all heading levels share one flat top margin (mt-0.5); size alone
  // differentiates level — no per-level margin scale.
  h1: ({ className, ...props }) => (
    <h1 className={cn('aui-md-h1 text-title font-bold mt-0.5 mb-2 first:mt-0', className)} {...props} />
  ),
  h2: ({ className, ...props }) => (
    <h2 className={cn('aui-md-h2 text-heading font-bold mt-0.5 mb-1.5 first:mt-0', className)} {...props} />
  ),
  h3: ({ className, ...props }) => (
    <h3 className={cn('aui-md-h3 text-body font-bold mt-0.5 mb-1 first:mt-0', className)} {...props} />
  ),
  h4: ({ className, ...props }) => (
    <h4 className={cn('aui-md-h4 text-body font-semibold mt-0.5 mb-1 first:mt-0', className)} {...props} />
  ),
  p: ({ className, ...props }) => (
    <p className={cn('aui-md-p my-2.5 leading-relaxed first:mt-0 last:mb-0', className)} {...props} />
  ),
  a: LinkWithPreview as FC<React.AnchorHTMLAttributes<HTMLAnchorElement>>,
  blockquote: ({ className, ...props }) => (
    <blockquote
      className={cn(
        'aui-md-blockquote border-s-[3px] border-primary/40 text-muted-foreground',
        'my-2.5 ps-3.5 italic',
        className,
      )}
      {...props}
    />
  ),
  ul: MarkdownUl,
  ol: MarkdownOl,
  li: MarkdownLi,
  input: MarkdownTaskCheckbox as FC<React.ComponentProps<'input'>>,
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

// Design: the whole markdown block sets a uniform tight letter-spacing.
export const MARKDOWN_ROOT_CLASS = 'aui-md tracking-tight';

// ── MarkdownText: TextMessagePartComponent ────────────────────────────────────

const MarkdownTextImpl: TextMessagePartComponent = () => {
  // `data-text-part` marks the searchable text container for in-chat Find
  // (FindBar walks [data-message-id] → [data-text-part]). The wrapper guarantees
  // the attribute lands on a real DOM node regardless of primitive prop-forwarding.
  return (
    <div data-text-part>
      <MarkdownTextPrimitive
        className={MARKDOWN_ROOT_CLASS}
        remarkPlugins={REMARK_PLUGINS}
        urlTransform={urlTransform}
        components={markdownComponents}
      />
    </div>
  );
};

export const MarkdownText: TextMessagePartComponent = memo(MarkdownTextImpl);
MarkdownText.displayName = 'MarkdownText';
