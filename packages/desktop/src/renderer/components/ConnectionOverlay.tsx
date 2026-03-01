import React from 'react';
import { Loader2 } from 'lucide-react';
import { useConnectionState } from '../hooks/useConnectionState';

export function ConnectionOverlayView({ connected }: { connected: boolean }): React.ReactElement | null {
  if (connected) return null;

  return (
    <div
      data-testid="connection-overlay"
      className="fixed inset-0 z-[9998] flex items-center justify-center bg-mf-overlay/60"
    >
      <div className="flex flex-col items-center gap-3 text-mf-text-primary">
        <Loader2 size={24} className="animate-spin text-mf-text-secondary" />
        <span className="text-sm text-mf-text-secondary">Reconnecting to daemon&hellip;</span>
      </div>
    </div>
  );
}

export function ConnectionOverlay(): React.ReactElement | null {
  const connected = useConnectionState();
  return <ConnectionOverlayView connected={connected} />;
}
