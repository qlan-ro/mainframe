/**
 * The `a` override for markdown: opens externally, previews the URL in a
 * tooltip, and copies it from a context menu.
 *
 * Extracted from `markdown-text.tsx` so the smart-action `SmartLink` wrapper
 * (#279) can delegate to it for every link it does not chip, without importing
 * the whole component map.
 */
import React, { useCallback } from 'react';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuGroup,
} from '@/components/ui/context-menu';
import { useHost } from '@/lib/host';
import { useMenuCopyFeedback } from '@/lib/ui/use-menu-copy-feedback';
import { CopyMenuItem } from '@/lib/ui/CopyMenuItem';
import { LINK_MENU_ROWS, httpLinkHref, openInMainframe, useCopyHref, type LinkMenuRowKey } from './link-menu-actions';

const ROW_TEST_IDS: Record<LinkMenuRowKey, string> = {
  'open-in-app': 'chat-link-open-in-app',
  'open-browser': 'chat-link-open',
};

export function LinkWithPreview({
  className,
  href,
  ...props
}: React.AnchorHTMLAttributes<HTMLAnchorElement>): React.ReactElement {
  const host = useHost();
  const { copied, copy } = useCopyHref(href);
  const { statusFor, handleOpenChange, onCopySelect } = useMenuCopyFeedback();
  const menuStatus = statusFor('copy-link');
  const inAppHref = httpLinkHref(href);

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

  const handleMenuCopy = onCopySelect('copy-link', copy);

  const rowHandlers: Record<LinkMenuRowKey, () => void> = {
    'open-in-app': () => inAppHref && openInMainframe(inAppHref),
    'open-browser': () => handleOpen(),
  };

  // Design: a faint border-bottom rule (not a solid text-decoration underline).
  const LINK_RULE_CLASS = 'aui-md-a text-primary no-underline border-b border-primary/40';

  if (!href) {
    return <a className={cn(LINK_RULE_CLASS, className)} {...props} />;
  }

  return (
    <Tooltip>
      <ContextMenu onOpenChange={handleOpenChange}>
        <TooltipTrigger asChild>
          <ContextMenuTrigger asChild>
            <a
              className={cn(LINK_RULE_CLASS, 'hover:opacity-80 transition-opacity cursor-pointer', className)}
              href={href}
              onClick={handleOpen}
              {...props}
              // stopPropagation only — never preventDefault: Radix composes a
              // nested trigger's own onContextMenu with checkForDefaultPrevented,
              // so calling preventDefault here would also block THIS link's menu.
              onContextMenu={(e) => e.stopPropagation()}
            />
          </ContextMenuTrigger>
        </TooltipTrigger>
        <ContextMenuContent>
          <ContextMenuGroup>
            {LINK_MENU_ROWS.filter((row) => row.key !== 'open-in-app' || inAppHref).map((row) => (
              <ContextMenuItem key={row.key} data-testid={ROW_TEST_IDS[row.key]} onSelect={rowHandlers[row.key]}>
                <row.icon />
                {row.label}
              </ContextMenuItem>
            ))}
            <CopyMenuItem testId="chat-link-copy" label="Copy link" status={menuStatus} onSelect={handleMenuCopy} />
          </ContextMenuGroup>
        </ContextMenuContent>
      </ContextMenu>
      <TooltipContent className="max-w-sm">
        <span className="truncate min-w-0">{href}</span>
        <button
          data-testid="chat-link-copy-url"
          type="button"
          onClick={(e) => void copy(e)}
          className={cn(
            'shrink-0 px-1.5 py-0.5 rounded-sm',
            'bg-accent hover:bg-muted text-muted-foreground hover:text-foreground',
            'transition-colors text-xs',
          )}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </TooltipContent>
    </Tooltip>
  );
}
