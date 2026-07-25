/**
 * The `a` override for markdown: opens externally, previews the URL in a
 * tooltip, and copies it from a context menu.
 *
 * Extracted from `markdown-text.tsx` so the smart-action `SmartLink` wrapper
 * (#279) can delegate to it for every link it does not chip, without importing
 * the whole component map.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem } from '@/components/ui/context-menu';
import { useHost } from '@/lib/host';

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
          console.warn('[link-with-preview] clipboard write failed');
        },
      );
    },
    [href],
  );
  return { copied, copy };
}

export function LinkWithPreview({
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
        console.warn('[link-with-preview] openExternal failed', href);
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
