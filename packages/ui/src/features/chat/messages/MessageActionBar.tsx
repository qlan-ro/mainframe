'use client';

/**
 * MessageActionBar — assistant-turn action bar (Copy + ExportMarkdown only).
 *
 * Adopts native ActionBarPrimitive (autohide=not-last, hideWhenRunning) with
 * our Button ghost/icon-sm sizing. Reload, Edit, Feedback and Speak are NOT
 * rendered — they require daemon endpoints or agent capabilities we don't have
 * yet (inventory decision: omit, not disable).
 *
 * ExportMarkdown lives in the ActionBarMore overflow menu so the bar stays
 * compact. The overflow is a native ActionBarMorePrimitive (DropdownMenu-backed)
 * which keeps the interaction-lock handshake so autohide doesn't collapse while
 * the menu is open.
 */

import type { FC } from 'react';
import { ActionBarPrimitive, ActionBarMorePrimitive, AuiIf } from '@assistant-ui/react';
import { CheckIcon, CopyIcon, DownloadIcon, MoreHorizontalIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

// ── Shared ghost icon button with tooltip ────────────────────────────────────

interface IconButtonProps {
  tooltip: string;
  'data-testid'?: string;
  className?: string;
  children: React.ReactNode;
}

const ActionIconButton = ({ tooltip, children, className, ...rest }: IconButtonProps) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <Button variant="ghost" size="icon-sm" className={cn('text-muted-foreground', className)} {...rest}>
        {children}
      </Button>
    </TooltipTrigger>
    <TooltipContent side="bottom">{tooltip}</TooltipContent>
  </Tooltip>
);

// ── Copy button — shows check icon while in copied state ─────────────────────

const CopyButton: FC = () => (
  <ActionBarPrimitive.Copy asChild>
    <ActionIconButton tooltip="Copy" data-testid="chat-message-copy">
      <AuiIf condition={(s) => s.message.isCopied}>
        <CheckIcon className="size-3.5" />
      </AuiIf>
      <AuiIf condition={(s) => !s.message.isCopied}>
        <CopyIcon className="size-3.5" />
      </AuiIf>
    </ActionIconButton>
  </ActionBarPrimitive.Copy>
);

// ── More overflow — ExportMarkdown item ──────────────────────────────────────

const MoreMenu: FC = () => (
  <ActionBarMorePrimitive.Root>
    <ActionBarMorePrimitive.Trigger asChild>
      <ActionIconButton
        tooltip="More"
        data-testid="chat-message-more"
        className="data-[state=open]:bg-accent data-[state=open]:text-accent-foreground"
      >
        <MoreHorizontalIcon className="size-3.5" />
      </ActionIconButton>
    </ActionBarMorePrimitive.Trigger>

    <ActionBarMorePrimitive.Content
      side="bottom"
      align="start"
      className={cn(
        'z-50 min-w-36 overflow-hidden rounded-lg border border-border',
        'bg-popover text-popover-foreground p-1',
        'shadow-[var(--mf-shadow-pop)]',
        'data-[state=open]:animate-in data-[state=closed]:animate-out',
        'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
        'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
      )}
    >
      <ActionBarPrimitive.ExportMarkdown asChild>
        <ActionBarMorePrimitive.Item
          data-testid="chat-message-export"
          className={cn(
            'flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5',
            'text-body outline-none transition-colors',
            'focus:bg-accent focus:text-accent-foreground',
            'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
          )}
        >
          <DownloadIcon className="size-3.5 shrink-0" />
          Export as Markdown
        </ActionBarMorePrimitive.Item>
      </ActionBarPrimitive.ExportMarkdown>
    </ActionBarMorePrimitive.Content>
  </ActionBarMorePrimitive.Root>
);

// ── Root export ──────────────────────────────────────────────────────────────

export const MessageActionBar: FC = () => (
  <ActionBarPrimitive.Root
    hideWhenRunning
    autohide="not-last"
    className="flex items-center gap-0.5 text-muted-foreground"
  >
    <CopyButton />
    <MoreMenu />
  </ActionBarPrimitive.Root>
);
