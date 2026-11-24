'use client';

/**
 * MessageActionBar — Copy, Fork and More for an agent's reply; Copy and More
 * for the user's own message (T1b). Native ActionBarPrimitive: the footer it
 * sits in owns showing and hiding. Reload, Edit, Feedback and Speak are NOT
 * rendered: they need daemon endpoints or agent capabilities we don't have.
 *
 * More quotes the message into the composer and exports it as Markdown.
 */

import type { FC } from 'react';
import { ActionBarPrimitive, ActionBarMorePrimitive, AuiIf, useAuiState } from '@assistant-ui/react';
import { CheckIcon, CopyIcon, DownloadIcon, MoreHorizontalIcon, QuoteIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useQuoteMessage } from './use-quote-message';
import { ActionIconButton } from './action-icon-button';
import { AssistantForkAction } from './AssistantForkAction';

// ── Copy button — shows check icon while in copied state ─────────────────────

const CopyButton: FC = () => (
  <ActionBarPrimitive.Copy asChild>
    <ActionIconButton tooltip="Copy" aria-label="Copy message" data-testid="chat-message-copy">
      <AuiIf condition={(s) => s.message.isCopied}>
        <CheckIcon />
      </AuiIf>
      <AuiIf condition={(s) => !s.message.isCopied}>
        <CopyIcon />
      </AuiIf>
    </ActionIconButton>
  </ActionBarPrimitive.Copy>
);

// ── More overflow ────────────────────────────────────────────────────────────

const ITEM_CLASS = cn(
  'flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5',
  'text-sm transition-colors focus:bg-muted focus:text-foreground focus-visible:focus-line-inset',
  'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
  "[&_svg:not([class*='size-'])]:size-4",
);

function QuoteItem() {
  const quote = useQuoteMessage();
  const content = useAuiState((s) => s.message.content);
  const text = content.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('\n\n');
  return (
    <ActionBarMorePrimitive.Item
      data-testid="chat-message-quote"
      disabled={!text.trim()}
      onSelect={() => quote(text)}
      className={ITEM_CLASS}
    >
      <QuoteIcon className="shrink-0" />
      Quote in reply
    </ActionBarMorePrimitive.Item>
  );
}

const MoreMenu: FC<{ user: boolean }> = ({ user }) => (
  <ActionBarMorePrimitive.Root>
    <ActionBarMorePrimitive.Trigger asChild>
      <ActionIconButton
        tooltip="More"
        aria-label="More actions"
        data-testid="chat-message-more"
        className="data-[state=open]:bg-muted data-[state=open]:text-foreground"
      >
        <MoreHorizontalIcon />
      </ActionIconButton>
    </ActionBarMorePrimitive.Trigger>

    <ActionBarMorePrimitive.Content
      side="bottom"
      align={user ? 'end' : 'start'}
      className={cn(
        'z-50 min-w-36 overflow-hidden rounded-md border border-border p-1',
        'bg-popover text-popover-foreground shadow-md',
        'data-[state=open]:animate-in data-[state=closed]:animate-out',
        'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
        'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
      )}
    >
      <QuoteItem />
      {!user && (
        <ActionBarPrimitive.ExportMarkdown asChild>
          <ActionBarMorePrimitive.Item data-testid="chat-message-export" className={ITEM_CLASS}>
            <DownloadIcon className="shrink-0" />
            Export as Markdown
          </ActionBarMorePrimitive.Item>
        </ActionBarPrimitive.ExportMarkdown>
      )}
    </ActionBarMorePrimitive.Content>
  </ActionBarMorePrimitive.Root>
);

// ── Root export ──────────────────────────────────────────────────────────────

export const MessageActionBar: FC<{ user?: boolean }> = ({ user = false }) => {
  const running = useAuiState(
    (s) => !user && (s.message.status?.type === 'running' || (s.thread.isRunning && s.message.isLast)),
  );
  if (running) return null;
  return (
    <ActionBarPrimitive.Root autohide="never" className="flex items-center gap-0.5 text-muted-foreground">
      <CopyButton />
      {!user && <AssistantForkAction />}
      <MoreMenu user={user} />
    </ActionBarPrimitive.Root>
  );
};
