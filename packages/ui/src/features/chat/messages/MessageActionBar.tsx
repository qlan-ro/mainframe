'use client';

/**
 * MessageActionBar — Copy, Fork and More for an agent's reply; Copy and More
 * for the user's own message (T1b). Native ActionBarPrimitive: the footer it
 * sits in owns showing and hiding. Reload, Edit, Feedback and Speak are NOT
 * rendered: they need daemon endpoints or agent capabilities we don't have.
 *
 * More quotes the message into the composer and exports it as Markdown.
 */

import { useEffect, useRef, useState, type FC } from 'react';
import { ActionBarPrimitive, ActionBarMorePrimitive, useAuiState } from '@assistant-ui/react';
import { CheckIcon, CopyIcon, DownloadIcon, MoreHorizontalIcon, QuoteIcon } from 'lucide-react';
import { downloadMarkdown } from './transcript-markdown';
import { cn } from '@/lib/utils';
import { quoteSource } from '../thread/quote-source';
import { useQuoteMessage } from './use-quote-message';
import { useTurnSelector } from './turn/turn-context';
import { useReplyText } from './use-reply-text';
import { ActionIconButton } from './action-icon-button';
import { AssistantForkAction } from './AssistantForkAction';

// ── Copy button — shows check icon while in copied state ─────────────────────

const COPIED_MS = 3000;

/** Copies the whole reply, which the primitive can't: it knows one message. */
const CopyButton: FC = () => {
  const replyText = useReplyText();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(replyText());
    } catch (error) {
      console.warn('[MessageActionBar] clipboard write failed', error);
      return;
    }
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), COPIED_MS);
  };
  const hasText = useAuiState((s) => s.message.content.some((part) => part.type === 'text' && part.text.length > 0));
  return (
    <ActionIconButton
      tooltip="Copy"
      aria-label="Copy message"
      data-testid="chat-message-copy"
      data-copied={copied ? 'true' : undefined}
      disabled={!hasText}
      onClick={() => void copy()}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
    </ActionIconButton>
  );
};

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
  const role = useAuiState((s) => s.message.role);
  const createdAt = useAuiState((s) => s.message.createdAt as Date | undefined);
  const replyText = useReplyText();
  const hasText = content.some((part) => part.type === 'text' && part.text.trim());
  return (
    <ActionBarMorePrimitive.Item
      data-testid="chat-message-quote"
      disabled={!hasText}
      onSelect={() => quote(replyText(), quoteSource({ role, createdAt }))}
      className={ITEM_CLASS}
    >
      <QuoteIcon className="shrink-0" />
      Quote in reply
    </ActionBarMorePrimitive.Item>
  );
}

const MoreMenu: FC<{ user: boolean }> = ({ user }) => {
  const replyText = useReplyText();
  return (
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
          <ActionBarPrimitive.ExportMarkdown asChild onExport={() => downloadMarkdown(replyText(), 'message')}>
            <ActionBarMorePrimitive.Item data-testid="chat-message-export" className={ITEM_CLASS}>
              <DownloadIcon className="shrink-0" />
              Export as Markdown
            </ActionBarMorePrimitive.Item>
          </ActionBarPrimitive.ExportMarkdown>
        )}
      </ActionBarMorePrimitive.Content>
    </ActionBarMorePrimitive.Root>
  );
};

// ── Root export ──────────────────────────────────────────────────────────────

export const MessageActionBar: FC<{ user?: boolean }> = ({ user = false }) => {
  const running = useAuiState(
    (s) => !user && (s.message.status?.type === 'running' || (s.thread.isRunning && s.message.isLast)),
  );
  const id = useAuiState((s) => s.message.id);
  // A turn that waits on a request has not ended, though the thread reports itself idle.
  const going = useTurnSelector(({ model }) => {
    const key = model.slices.get(id)?.turnKey;
    return key !== undefined && model.turns.get(key)?.running === true;
  }, false);
  if (running || (!user && going)) return null;
  return (
    <ActionBarPrimitive.Root autohide="never" className="flex items-center gap-0.5 text-muted-foreground">
      <CopyButton />
      {!user && <AssistantForkAction />}
      <MoreMenu user={user} />
    </ActionBarPrimitive.Root>
  );
};
