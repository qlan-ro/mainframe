/**
 * App — sessions shell (step 11). The REAL application root.
 *
 * App owns only the connection gate + the persistent status badge; once a port
 * is live it mounts AppShell, which holds the one global runtime wrapped in
 * DaemonPortProvider (so useDaemonPort resolves for the whole sessions runtime
 * layer).
 */
import { useEffect } from 'react';
import { useConnectionState } from './useConnectionState';
import { daemonWs } from '../lib/daemon/ws-client';
import { DaemonPortProvider } from '../features/sessions/runtime/daemon-port-context';
import { AppShell } from './AppShell';
import { AppStatusBar } from '../layout/AppStatusBar';
import { Toaster } from '@/components/ui/sonner';

export function App() {
  const { state, daemonStatus, port } = useConnectionState();

  // Wire the WS client to the port once available (AppShell's router subscribes).
  useEffect(() => {
    if (port == null) return;
    daemonWs.setPort(port);
    daemonWs.connect();
  }, [port]);

  return (
    <div className="flex h-screen flex-col bg-mf-window text-foreground font-sans">
      {port != null ? (
        <DaemonPortProvider port={port}>
          <AppShell port={port} />
        </DaemonPortProvider>
      ) : (
        <div
          data-testid="app-waiting-daemon"
          className="flex flex-1 items-center justify-center bg-mf-window text-muted-foreground"
        >
          <span className="text-body">Waiting for daemon…</span>
        </div>
      )}

      <AppStatusBar state={state} daemonStatus={daemonStatus} />
      <Toaster />
    </div>
  );
}
