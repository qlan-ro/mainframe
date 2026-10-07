/**
 * AgentOutboxChip — above the composer, the messages the daemon holds for
 * this chat until its turn ends: another agent's `chat_send`, or a delegated
 * task's result. Each can be cancelled before it is delivered.
 *
 * Daemon-held, like `QueuedUserTurn`, so assistant-ui's local `Queue` model
 * does not apply: the entries are `Chat.agentOutbox`, re-announced with
 * `chat.updated` on every change, and a cancel just fires the DELETE — the
 * broadcast that follows removes the row (server-authoritative, no optimistic
 * edit).
 */
import { useState } from 'react';
import { Bot, X } from 'lucide-react';
import { useAuiState } from '@assistant-ui/react';
import { Button } from '@/components/ui/button';
import { Hint } from '@/components/ui/hint';
import { cancelAgentOutboxEntry } from '@/lib/api/chats';
import { mfToast } from '@/lib/toast';
import { useDaemonPort } from '@/features/sessions/runtime/daemon-port-context';
import { activeSessionCustom } from '@/features/sessions/view-model/chat-to-thread-custom';
import { outboxHeadline } from '@/features/sessions/view-model/agent-provenance';
import { findSession, useSessionItems } from './use-session-items';

function useCancel(chatId: string | null) {
  const port = useDaemonPort();
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  async function cancel(entryId: string) {
    if (chatId == null) return;
    setPending((prev) => new Set(prev).add(entryId));
    try {
      await cancelAgentOutboxEntry(port, chatId, entryId);
    } catch (err) {
      // Usually a 404: the message went out between the render and the click.
      console.warn('[chat/AgentOutboxChip] cancel failed', err);
      mfToast.warning('That message was already sent');
    } finally {
      setPending((prev) => {
        const next = new Set(prev);
        next.delete(entryId);
        return next;
      });
    }
  }
  return { pending, cancel };
}

export function AgentOutboxChip() {
  const custom = useAuiState((s) => activeSessionCustom(s.threadListItem, s.threads.threadItems));
  const chatId = useAuiState((s) => s.threadListItem?.remoteId ?? null);
  const items = useSessionItems();
  const { pending, cancel } = useCancel(chatId);
  const entries = custom?.agentOutbox ?? [];
  if (chatId == null || entries.length === 0) return null;

  const titleOf = (id: string) => `"${findSession(items, id)?.title ?? 'another chat'}"`;
  return (
    <div
      data-testid="chat-composer-agent-outbox-chip"
      className="mb-2 flex flex-col gap-1 rounded-lg border border-border bg-muted px-3 py-2"
    >
      <span className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Bot aria-hidden className="size-3.5 shrink-0" />
        <span className="min-w-0 truncate">{outboxHeadline(entries, titleOf)}</span>
      </span>
      {entries.map((entry) => (
        <div key={entry.entryId} className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{entry.preview}</span>
          <Hint label="Don't send this message">
            <Button
              data-testid={`chat-composer-agent-outbox-cancel-${entry.entryId}`}
              aria-label="Don't send this message"
              variant="ghost"
              size="icon-xs"
              disabled={pending.has(entry.entryId)}
              onClick={() => void cancel(entry.entryId)}
              className="text-muted-foreground"
            >
              <X />
            </Button>
          </Hint>
        </div>
      ))}
    </div>
  );
}
