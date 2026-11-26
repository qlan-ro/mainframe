'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useAuiState } from '@assistant-ui/react';
import { CircleAlert, Loader2, RotateCcwIcon, XIcon } from 'lucide-react';
import { PencilIcon } from '@/components/ui/glyphs';
import type { QueuedMessageRef } from '@qlan-ro/mainframe-types';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { mfToast } from '@/lib/toast';
import {
  cancelScheduledResend,
  confirmQueuedMessage,
  replayQueuedMessage,
  resumeQueuedMessages,
} from '@/lib/api/chats';
import { useChatExtras } from '../../runtime/chat-extras';
import { sendErrorMessage, sendRefusal } from '../../controller/describe-send-error';
import { visibleMessageText } from '../../markers/message-markers';
import { ComposerHint } from '../composer-card-context';
import { useComposerEdit } from '../edit/composer-edit-context';
import { focusVisibleComposer } from '../focus-composer';
import { CLAIM_MS, settled, useHeldQueue, type HeldMessage } from './held-queue-store';

const NO_ROWS: readonly HeldMessage[] = [];

interface QueueRow {
  messageId: string;
  content: string;
  attachments: number;
  failure?: string;
  action?: { label: string; testId: string; onClick: () => void; icon?: ReactNode };
  onMarkSent?: () => void;
  note?: string;
  leaving?: boolean;
  sending?: boolean;
  onEdit?: () => void;
  onRemove?: () => void;
}

const DELIVERY_FAILURE: Record<string, string> = {
  rejected: 'Not sent: the agent refused it. The queue is paused.',
  unconfirmed: 'Not confirmed by the agent. It may have been received.',
};

const DELIVERY_NOTE: Partial<Record<string, string>> = {
  unconfirmed: 'Uncertain',
  resend_scheduled: 'Resend scheduled',
};

const report = (what: string) => (error: unknown) => {
  console.warn(`[queue] ${what} failed`, { error });
  mfToast.error(`Could not ${what} the queued message`, {
    description: sendRefusal(error) ?? sendErrorMessage(error),
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
        className="size-6 rounded-sm text-muted-foreground hover:bg-sidebar-accent"
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
      data-sending={row.sending || undefined}
      className={cn(
        'flex min-h-8 min-w-0 items-center gap-2 rounded-md py-0.5 pr-0.5 pl-2.5 text-body motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1',
        row.failure ? 'bg-fail/6 ring-1 ring-fail/28 ring-inset' : 'bg-queue-well',
      )}
    >
      {row.sending && (
        <Loader2 className="size-3.5 shrink-0 animate-spin text-live motion-reduce:animate-none" aria-hidden />
      )}
      {row.failure && <CircleAlert className="size-4 shrink-0 text-fail" aria-hidden />}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex min-w-0 gap-2">
          {(!row.failure || row.note) && (
            <span
              role={row.sending ? 'status' : undefined}
              className="shrink-0 self-center text-caption/[1.45] font-semibold text-muted-foreground"
            >
              {row.note ?? 'Queued'}
            </span>
          )}
          <span className="min-w-0 truncate" title={text} data-testid="chat-queued-bubble">
            {[text, files].filter(Boolean).join(' · ')}
          </span>
        </span>
        {row.failure && <span className="text-meta/[1.3] text-fail">{row.failure}</span>}
      </span>
      {row.onMarkSent && (
        <Button type="button" variant="ghost" size="xs" onClick={row.onMarkSent} className="shrink-0">
          Mark as sent
        </Button>
      )}
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
          <PencilIcon className="size-4" />
        </IconAction>
      )}
      {row.onRemove && (
        <IconAction label="Remove" testId="chat-queued-cancel" onClick={row.onRemove}>
          <XIcon className="size-4" />
        </IconAction>
      )}
    </div>
  );
}

function useQueuedRows(): QueueRow[] {
  const extras = useChatExtras();
  const { startEdit } = useComposerEdit();
  const queued = Object.values(extras?.queued ?? {})
    .filter((ref): ref is QueuedMessageRef => ref != null && ref.steered !== true)
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const blockedHead = ['unconfirmed', 'resend_scheduled'].includes(queued[0]?.delivery ?? '');
  const resumeIndex = queued.findIndex((row) => row.pauseReason != null);
  return queued.map(({ messageId, content, attachmentIds, delivery, pauseReason, chatId }, index) => ({
    messageId,
    content,
    attachments: attachmentIds?.length ?? 0,
    note:
      DELIVERY_NOTE[delivery ?? ''] ??
      (blockedHead ? 'Waiting on the message above' : pauseReason && `Paused · ${pauseReason}`),
    failure: delivery ? DELIVERY_FAILURE[delivery] : undefined,
    onMarkSent:
      delivery === 'unconfirmed' && extras
        ? () => void confirmQueuedMessage(extras.port, chatId, messageId).catch(report('mark as sent'))
        : undefined,
    action:
      delivery === 'resend_scheduled' && extras
        ? {
            label: 'Cancel resend',
            testId: 'chat-queued-cancel-resend',
            onClick: () => void cancelScheduledResend(extras.port, chatId, messageId).catch(report('cancel resend')),
          }
        : delivery === 'unconfirmed' && extras
          ? {
              label: 'Send again (may duplicate)',
              testId: 'chat-queued-replay',
              onClick: () => void replayQueuedMessage(extras.port, chatId, messageId).catch(report('send')),
            }
          : !blockedHead && delivery !== 'rejected' && pauseReason && extras && index === resumeIndex
            ? {
                label: 'Resume',
                testId: 'chat-queue-resume',
                onClick: () => void resumeQueuedMessages(extras.port, chatId).catch(report('resume')),
              }
            : delivery === 'rejected'
              ? {
                  label: 'Retry',
                  testId: 'chat-queued-retry',
                  icon: <RotateCcwIcon data-icon="inline-start" />,
                  onClick: () => void extras?.editQueued(messageId, content).catch(report('retry')),
                }
              : undefined,
    onEdit: delivery ? undefined : () => startEdit({ messageId, content }),
    onRemove:
      delivery === 'resend_scheduled' ? undefined : () => void extras?.cancelQueued(messageId).catch(report('remove')),
  }));
}

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
  // One that reached the conversation after all is not held any more: forget it.
  useEffect(() => {
    for (const id of sentIds.split('\n')) if (id) useHeldQueue.getState().remove(chatId, id);
  }, [sentIds, chatId]);
  const now = useClaimClock(held);
  const queuedIds = new Set(Object.values(extras?.queued ?? {}).map((ref) => ref.messageId));
  const rows = held
    .filter((row) => !sentIds.split('\n').includes(row.messageId) && !queuedIds.has(row.messageId))
    .map((row) => settled(row, now));
  const busy = rows.some((row) => row.claim);
  return rows.map((row, index) => {
    const base = { messageId: row.messageId, content: row.content, attachments: row.attachmentIds?.length ?? 0 };
    // On its way, or about to be: nothing to press until it is sent or comes back.
    if (row.claim) {
      const { started } = row.claim;
      return { ...base, note: started ? 'Sending…' : 'Waiting', leaving: true, sending: started };
    }
    return {
      ...base,
      failure: heldFailure(row, index),
      note: 'Waiting',
      action:
        index === 0 && !busy
          ? {
              label: row.unconfirmed ? 'Send again (may duplicate)' : 'Send now',
              testId: 'chat-queued-send-now',
              onClick: () => {
                void extras?.sendHeld(row.messageId).catch(report('send'));
                focusVisibleComposer();
              },
            }
          : undefined,
      onEdit: () =>
        startEdit({ messageId: row.messageId, content: row.content, save: saveHeld(chatId, row.messageId) }),
      onRemove: () => useHeldQueue.getState().remove(chatId, row.messageId),
    };
  });
}

function heldFailure(row: HeldMessage, index: number): string | undefined {
  if (row.unconfirmed) return UNCONFIRMED;
  if (row.refused) return `Not sent: ${row.refused}`;
  return index === 0 ? 'Not sent: the session stopped.' : undefined;
}

const UNCONFIRMED = 'It may already have reached the agent. Check the conversation before sending it again.';

/** An edit never fails in silence: a row on its way is not changed. */
const saveHeld = (chatId: string, messageId: string) => async (content: string) => {
  if (!useHeldQueue.getState().edit(chatId, messageId, content)) {
    throw new Error('This message is being sent, or is gone.');
  }
};

/** The time, read again whenever a claim runs out. */
function useClaimClock(held: readonly HeldMessage[]): number {
  const [now, setNow] = useState(() => Date.now());
  const newest = Math.max(0, ...held.map((row) => row.claim?.at ?? 0));
  useEffect(() => {
    if (newest === 0) return;
    const timer = setTimeout(() => setNow(Date.now()), Math.max(0, newest + CLAIM_MS - Date.now()));
    return () => clearTimeout(timer);
  }, [newest]);
  return now;
}

export function QueuedRows() {
  const held = useHeldRows();
  const rows = [...held.filter((row) => !row.leaving), ...useQueuedRows(), ...held.filter((row) => row.leaving)];
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
