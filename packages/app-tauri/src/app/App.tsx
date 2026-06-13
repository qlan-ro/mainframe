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
import { initLspPort } from '../lib/lsp';
import { DaemonPortProvider } from '../features/sessions/runtime/daemon-port-context';
import { AppShell } from './AppShell';
import { ConnectionStatusProvider } from './ConnectionStatusContext';
import { ThemeEffect } from './ThemeEffect';
import { Toaster } from '@/components/ui/sonner';

export function App() {
  const { state, daemonStatus, port, ready } = useConnectionState();

  // Wire the WS client to the port once available (AppShell's router subscribes).
  useEffect(() => {
    if (port == null) return;
    daemonWs.setPort(port);
    daemonWs.connect();
    // Hand the daemon port to the LSP singleton (constructed with port=0);
    // without this every ensureClient targets ws://127.0.0.1:0 and fails.
    void initLspPort();
  }, [port]);

  return (
    <div className="flex h-screen flex-col bg-mf-window text-foreground font-sans">
      <ThemeEffect />
      <ConnectionStatusProvider value={{ state, daemonStatus }}>
        {/* Gate the data shell on `ready` (first successful /health), not merely
            on a known port — the sidecar opens its port before it accepts
            requests, so mounting on port-known alone races the initial REST
            loads. `ready` latches, so a later blip won't unmount the shell. */}
        {ready && port != null ? (
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
      </ConnectionStatusProvider>
      <Toaster />
    </div>
  );
}
