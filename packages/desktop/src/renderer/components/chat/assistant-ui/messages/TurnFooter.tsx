import React from 'react';
import { useMessage } from '@assistant-ui/react';
import { getExternalStoreMessages } from '@assistant-ui/react';
import type { DisplayMessage } from '@qlan-ro/mainframe-types';
import { formatTurnDuration } from '../message-parsing';
import { createLogger } from '../../../../lib/logger';

const log = createLogger('renderer:turn-footer');

// Why a boundary here: assistant-ui's tapClientLookup can throw
// "Index N out of bounds (length: N)" during concurrent renders when the
// external messages array shrinks between a parent's captured index and a
// descendant hook's read. Without isolation, the whole turn (and up to the
// root ErrorBoundary) fails to render. Scoping the failure to the footer
// keeps the turn visible; React recovers on the next stable render.
class TurnFooterBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean }> {
  state = { hasError: false };

  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true };
  }

  componentDidCatch(error: Error): void {
    log.warn('turn footer render failed', { message: error.message });
  }

  componentDidUpdate(_prev: { children: React.ReactNode }): void {
    if (this.state.hasError) this.setState({ hasError: false });
  }

  render(): React.ReactNode {
    return this.state.hasError ? null : this.props.children;
  }
}

function TurnFooterInner() {
  const message = useMessage();
  const [original] = getExternalStoreMessages<DisplayMessage>(message);
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

export function TurnFooter() {
  return (
    <TurnFooterBoundary>
      <TurnFooterInner />
    </TurnFooterBoundary>
  );
}
