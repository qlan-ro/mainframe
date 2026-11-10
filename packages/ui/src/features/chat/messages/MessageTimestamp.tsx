'use client';

/**
 * MessageTimestamp — the turn's clock time (e.g. "2:32 PM"), shown in the
 * assistant footer row alongside the action bar + timing. The native
 * ActionBarPrimitive has no timestamp; we read the message's `createdAt`
 * (projected from DisplayMessage.timestamp in convert-message).
 *
 * Hidden until the message has content: a turn that has started but not yet
 * produced anything carries only the ≥1-part placeholder (one empty text
 * part), and a lone clock under nothing reads as noise.
 */
import { useAuiState } from '@assistant-ui/react';
import { useTurnStatusTail } from '../thread/turn-status-tail';

type MessageSlice = { message: { createdAt?: Date; content: readonly { type: string; text?: string }[] } };

export function TimestampLabel({ createdAt }: { createdAt: Date }) {
  return (
    <span data-testid="chat-message-timestamp" className="font-mono text-xs tabular-nums text-muted-foreground">
      {createdAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
    </span>
  );
}

export function MessageTimestamp() {
  const createdAt = useAuiState((s) => (s as MessageSlice).message.createdAt);
  const empty = useAuiState((s) =>
    (s as MessageSlice).message.content.every((part) => part.type === 'text' && !part.text),
  );
  const id = useAuiState((s) => (s as { message: { id: string } }).message.id);
  const tail = useTurnStatusTail();
  // While the status row shows under this message, the clock follows the row instead.
  if (tail?.visible && tail.anchorId === id) return null;
  if (!createdAt || empty) return null;
  return <TimestampLabel createdAt={createdAt} />;
}
