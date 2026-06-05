'use client';

/**
 * MessageTimestamp — the turn's clock time (e.g. "2:32 PM"), shown in the
 * assistant footer row alongside the action bar + timing. The native
 * ActionBarPrimitive has no timestamp; we read the message's `createdAt`
 * (projected from DisplayMessage.timestamp in convert-message).
 */
import { useAuiState } from '@assistant-ui/react';

export function MessageTimestamp() {
  const createdAt = useAuiState((s) => (s as { message: { createdAt?: Date } }).message.createdAt);
  if (!createdAt) return null;
  const label = createdAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return (
    <span data-testid="chat-message-timestamp" className="font-mono text-micro tabular-nums text-mf-text-4">
      {label}
    </span>
  );
}
