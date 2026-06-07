/**
 * App — sessions shell (step 11). The REAL application root.
 *
 * App owns only the connection gate + the persistent status badge; once a port
 * is live it mounts AppShell, which holds the one global runtime wrapped in
 * DaemonPortProvider (so useDaemonPort resolves for the whole sessions runtime
 * layer).
 */
import { useEffect } from 'react';
import { useConnectionState, type ConnectionState } from './useConnectionState';
import { cn } from '@/lib/utils';
import { daemonWs } from '../lib/daemon/ws-client';
import { DaemonPortProvider } from '../features/sessions/runtime/daemon-port-context';
import { AppShell } from './AppShell';
import { Toaster } from '@/components/ui/sonner';

const STATUS_DOT: Record<ConnectionState, string> = {
  connecting: 'bg-mf-warning',
  connected: 'bg-mf-success',
  disconnected: 'bg-destructive',
};

function StatusBadge({
  state,
  daemonStatus,
  port,
}: {
  state: ConnectionState;
  daemonStatus: string;
  port: number | null;
}) {
  return (
    <div
      data-testid="app-status-bar"
      className="fixed right-3 top-2 z-[200] flex items-center gap-1.5 text-caption text-muted-foreground"
    >
      <span data-testid="app-connection-dot" className={cn('inline-block size-2 rounded-full', STATUS_DOT[state])} />
      <span>
        {daemonStatus}
        {port != null ? ` · ${port}` : ''}
      </span>
    </div>
  );
}

export function App() {
  const { state, daemonStatus, port } = useConnectionState();

  // Wire the WS client to the port once available (AppShell's router subscribes).
  useEffect(() => {
    if (port == null) return;
    daemonWs.setPort(port);
    daemonWs.connect();
  }, [port]);

  return (
    <div className="flex h-screen flex-col bg-background text-foreground font-sans">
      {/* Drag region for macOS traffic lights */}
      <div data-tauri-drag-region className="fixed inset-x-0 top-0 z-[100] h-10" />

      <StatusBadge state={state} daemonStatus={daemonStatus} port={port} />

      {port != null ? (
        <DaemonPortProvider port={port}>
          <AppShell port={port} />
        </DaemonPortProvider>
      ) : (
        <div
          data-testid="app-waiting-daemon"
          className="flex h-screen items-center justify-center bg-background text-muted-foreground"
        >
          <span className="text-body">Waiting for daemon…</span>
        </div>
      )}

      <Toaster />
    </div>
  );
}
