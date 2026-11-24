'use client';

/**
 * The queue, as rows at the top of the card (C10). Rows the agent still holds
 * send when it finishes; rows a Stop took back wait for the user, the first
 * one saying so. Only a stop turns a row failed, never a normal drain.
 */
import type { ReactNode } from 'react';
import { useAuiState } from '@assistant-ui/react';
import { CircleAlert, PencilIcon, RotateCcwIcon, XIcon } from 'lucide-react';
import type { QueuedMessageRef } from '@qlan-ro/mainframe-types';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { mfToast } from '@/lib/toast';
import { useChatExtras } from '../../runtime/chat-extras';
import { visibleMessageText } from '../../markers/message-markers';
import { ComposerHint } from '../composer-card-context';
import { useComposerEdit } from '../edit/composer-edit-context';
import { focusVisibleComposer } from '../focus-composer';
import { useHeldQueue, type HeldMessage } from './held-queue-store';

const NO_ROWS: readonly HeldMessage[] = [];

interface QueueRow {
  messageId: string;
  content: string;
  attachments: number;
  /** Why the row did not go out, or undefined while it is simply waiting. */
  failure?: string;
  action?: { label: string; testId: string; onClick: () => void; icon?: ReactNode };
  note?: string;
  onEdit?: () => void;
  onRemove: () => void;
}

const DELIVERY_FAILURE: Record<string, string> = {
  rejected: 'Not sent: the agent refused it. The queue is paused.',
  unconfirmed: 'Delivery uncertain. Check the agent’s history; removing it only clears it here.',
};

const report = (what: string) => (error: unknown) => {
  console.warn(`[queue] ${what} failed`, { error });
  mfToast.error(`Could not ${what} the queued message`, {
    description: error instanceof Error ? error.message : String(error),
  });
};

function IconAction({
  label,
  testId,
  onClick,
  children,
}: {
  label: string;
  testId: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <ComposerHint label={label}>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        data-testid={testId}
        aria-label={`${label} queued message`}
        onClick={onClick}
        className="size-6 text-muted-foreground"
      >
        {children}
      </Button>
    </ComposerHint>
  );
}

function Row({ row }: { row: QueueRow }) {
  const text = visibleMessageText(row.content);
  const files = row.attachments > 0 ? `${row.attachments} file${row.attachments === 1 ? '' : 's'}` : '';
  return (
    <div
      role="listitem"
      data-testid="chat-queued-message"
      data-queued-id={row.messageId}
      data-failed={row.failure ? true : undefined}
      className={cn(
        'flex min-h-8 min-w-0 items-center gap-2 rounded-lg py-0.5 pr-0.5 pl-2.5 text-sm motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1',
        row.failure ? 'bg-fail/6 ring-1 ring-fail/28 ring-inset' : 'bg-muted',
      )}
    >
      {row.failure && <CircleAlert className="size-4 shrink-0 text-fail" aria-hidden />}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex min-w-0 gap-2">
          {!row.failure && (
            <span className="shrink-0 text-xs leading-[inherit] font-semibold text-muted-foreground">
              {row.note ?? 'Queued'}
            </span>
          )}
          <span className="min-w-0 truncate" title={text} data-testid="chat-queued-bubble">
            {[text, files].filter(Boolean).join(' · ')}
          </span>
        </span>
        {row.failure && <span className="text-xs text-fail">{row.failure}</span>}
      </span>
      {row.action && (
        <Button
          type="button"
          variant="ghost"
          size="xs"
          data-testid={row.action.testId}
          onClick={row.action.onClick}
          className="shrink-0 font-semibold text-accent-ink hover:text-accent-ink"
        >
          {row.action.icon}
          {row.action.label}
        </Button>
      )}
      {row.onEdit && (
        <IconAction label="Edit" testId="chat-queued-edit" onClick={row.onEdit}>
          <PencilIcon />
        </IconAction>
      )}
      <IconAction label="Remove" testId="chat-queued-cancel" onClick={row.onRemove}>
        <XIcon />
      </IconAction>
    </div>
  );
}

function useQueuedRows(): QueueRow[] {
  const extras = useChatExtras();
  const { startEdit } = useComposerEdit();
  const queued = Object.values(extras?.queued ?? {})
    .filter((ref): ref is QueuedMessageRef => ref != null && ref.steered !== true)
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  return queued.map(({ messageId, content, attachmentIds, delivery }) => ({
    messageId,
    content,
    attachments: attachmentIds?.length ?? 0,
    failure: delivery ? DELIVERY_FAILURE[delivery] : undefined,
    action:
      delivery === 'rejected'
        ? {
            label: 'Retry',
            testId: 'chat-queued-retry',
            icon: <RotateCcwIcon data-icon="inline-start" />,
            onClick: () => void extras?.editQueued(messageId, content).catch(report('retry')),
          }
        : undefined,
    onEdit: delivery ? undefined : () => startEdit({ messageId, content }),
    onRemove: () => void extras?.cancelQueued(messageId).catch(report('remove')),
  }));
}

/**
 * Rows a Stop took back. One the agent had already picked up is still in its
 * queue or in the transcript, so it is not held after all.
 */
function useHeldRows(): QueueRow[] {
  const extras = useChatExtras();
  const chatId = extras?.state.chatId ?? '';
  const { startEdit } = useComposerEdit();
  const held = useHeldQueue((s) => s.byChat[chatId] ?? NO_ROWS);
  const sentIds = useAuiState((s) =>
    s.thread.messages
      .filter((m) => held.some((row) => row.messageId === m.id))
      .map((m) => m.id)
      .join('\n'),
  );
  const queuedIds = new Set(Object.values(extras?.queued ?? {}).map((ref) => ref.messageId));
  const { edit, remove } = useHeldQueue.getState();
  return held
    .filter((row) => !sentIds.split('\n').includes(row.messageId) && !queuedIds.has(row.messageId))
    .map(({ messageId, content, attachmentIds }, index) => ({
      messageId,
      content,
      attachments: attachmentIds?.length ?? 0,
      failure: index === 0 ? 'Not sent: the session stopped.' : undefined,
      note: 'Waiting',
      action:
        index === 0
          ? {
              label: 'Send now',
              testId: 'chat-queued-send-now',
              onClick: () => {
                void extras?.sendHeld(messageId).catch(report('send'));
                focusVisibleComposer();
              },
            }
          : undefined,
      onEdit: () => startEdit({ messageId, content, save: async (next) => edit(chatId, messageId, next) }),
      onRemove: () => remove(chatId, messageId),
    }));
}

export function QueuedRows() {
  const rows = [...useHeldRows(), ...useQueuedRows()];
  if (rows.length === 0) return null;
  return (
    <div
      role="list"
      aria-label="Queued messages"
      data-testid="chat-composer-queue"
      className="mb-2 flex max-h-40 flex-col gap-1.5 overflow-y-auto"
    >
      {rows.map((row) => (
        <Row key={row.messageId} row={row} />
      ))}
    </div>
  );
}
