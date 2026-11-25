/**
 * The one link of a reply (T1d): blue, underlined, its address in a tooltip and
 * the ways to open it in the context menu. A raw URL is set in mono.
 */
import { useRef, useState, type AnchorHTMLAttributes, type MouseEvent, type ReactElement, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { CopyMenuItem } from '@/lib/ui/CopyMenuItem';
import { useMenuCopyFeedback, type UseMenuCopyFeedback } from '@/lib/ui/use-menu-copy-feedback';
import { LINK_MENU_ROWS, httpLinkHref, useCopyHref, type LinkMenuRowKey } from '../parts/link-menu-actions';
import { useLinkDragSelect } from '../parts/link-drag-select';

export interface LinkAnchorProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  href: string;
  onOpen: () => void;
  onOpenIn: (key: LinkMenuRowKey) => void;
  /** Said in the tooltip under the address. */
  note?: string;
  /** More context-menu groups, above "Copy link". */
  menu?: ReactNode;
}

const ROW_TEST_IDS: Record<LinkMenuRowKey, string> = {
  'open-in-app': 'chat-link-open-in-app',
  'open-browser': 'chat-link-open',
};

const isRaw = (children: ReactNode, href: string) =>
  typeof children === 'string' && (children === href || `${children}/` === href);

interface LinkMenuProps extends Pick<LinkAnchorProps, 'href' | 'onOpenIn' | 'menu'> {
  feedback: UseMenuCopyFeedback;
}

function LinkMenu({ href, onOpenIn, menu, feedback }: LinkMenuProps) {
  const { copy } = useCopyHref(href);
  const { statusFor, onCopySelect } = feedback;
  const rows = LINK_MENU_ROWS.filter((row) => row.key !== 'open-in-app' || httpLinkHref(href));
  return (
    <ContextMenuContent>
      <ContextMenuGroup>
        {rows.map((row) => (
          <ContextMenuItem key={row.key} data-testid={ROW_TEST_IDS[row.key]} onSelect={() => onOpenIn(row.key)}>
            <row.icon />
            {row.label}
          </ContextMenuItem>
        ))}
      </ContextMenuGroup>
      {menu}
      <ContextMenuGroup>
        <CopyMenuItem
          testId="chat-link-copy"
          label="Copy link"
          status={statusFor('copy-link')}
          onSelect={onCopySelect('copy-link', copy)}
        />
      </ContextMenuGroup>
    </ContextMenuContent>
  );
}

export function LinkAnchor({
  href,
  onOpen,
  onOpenIn,
  note,
  menu,
  className,
  children,
  onBlur,
  onKeyDown,
  ...props
}: LinkAnchorProps): ReactElement {
  const { onMouseDown, endedDrag } = useLinkDragSelect();
  const feedback = useMenuCopyFeedback();
  const { copied, copy } = useCopyHref(href);
  const [tipOpen, setTipOpen] = useState(false);
  const copyButton = useRef<HTMLButtonElement>(null);
  const handleClick = (event: MouseEvent) => {
    event.preventDefault();
    if (!endedDrag()) onOpen();
  };
  return (
    <Tooltip open={tipOpen} onOpenChange={setTipOpen}>
      <ContextMenu onOpenChange={feedback.handleOpenChange}>
        <TooltipTrigger asChild>
          {/* select-text overrides the trigger primitive's select-none: WebKit drops a
              user-select:none link from Cmd+C even while it is highlighted (#396). */}
          <ContextMenuTrigger asChild className="select-text">
            <a
              {...props}
              href={href}
              data-testid="chat-link"
              className={cn(
                'mf-link rounded-sm focus-visible:focus-line',
                isRaw(children, href) && 'font-mono mf-link-mono',
                className,
              )}
              onClick={handleClick}
              onBlur={(event) => {
                onBlur?.(event);
                if (copyButton.current && event.relatedTarget === copyButton.current) event.preventDefault();
              }}
              onKeyDown={(event) => {
                onKeyDown?.(event);
                if (!event.defaultPrevented && event.key === 'Tab' && !event.shiftKey && copyButton.current) {
                  event.preventDefault();
                  copyButton.current.focus();
                }
              }}
              // stopPropagation only, never preventDefault: Radix composes a
              // nested trigger's own onContextMenu with checkForDefaultPrevented,
              // so calling preventDefault here would also block THIS link's menu.
              onContextMenu={(event) => event.stopPropagation()}
              // A drag starting here selects text instead of dragging the link (#396).
              draggable={false}
              onMouseDown={onMouseDown}
            >
              {children}
            </a>
          </ContextMenuTrigger>
        </TooltipTrigger>
        <LinkMenu href={href} onOpenIn={onOpenIn} menu={menu} feedback={feedback} />
      </ContextMenu>
      <TooltipContent className="max-w-sm flex-col items-start gap-0.5 break-all">
        <div className="flex w-full items-center gap-2">
          <span className="min-w-0 truncate">{href}</span>
          <button
            ref={copyButton}
            type="button"
            data-testid="chat-link-copy-url"
            onBlur={() => setTipOpen(false)}
            onClick={(event) => void copy(event)}
            className="shrink-0 rounded-sm bg-accent px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:focus-line"
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
        {note && <span data-testid="chat-link-note">{note}</span>}
      </TooltipContent>
    </Tooltip>
  );
}
