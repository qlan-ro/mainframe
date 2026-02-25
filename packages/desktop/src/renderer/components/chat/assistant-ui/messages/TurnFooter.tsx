import React from 'react';
import { useMessage } from '@assistant-ui/react';
import { getExternalStoreMessages } from '@assistant-ui/react';
import type { ChatMessage } from '@mainframe/types';
import { formatTurnDuration } from '../message-parsing';

export function TurnFooter() {
  const message = useMessage();
  const [original] = getExternalStoreMessages<ChatMessage>(message);
  if (!original?.timestamp) return null;
  const durationMs = typeof original.metadata?.turnDurationMs === 'number' ? original.metadata.turnDurationMs : null;
  const time = new Date(original.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return (
    <span
      data-testid="turn-footer"
      className="text-[10px] font-mono text-mf-text-secondary opacity-0 group-hover:opacity-40 transition-opacity"
    >
      {durationMs !== null ? `${time} · ${formatTurnDuration(durationMs)}` : time}
    </span>
  );
}
