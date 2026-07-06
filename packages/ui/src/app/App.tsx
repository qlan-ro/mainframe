/**
 * App — sessions shell (step 11). The REAL application root.
 *
 * App owns only the connection gate + the persistent status badge; once a port
 * is live it mounts AppShell wrapped in ActiveDaemonProvider. AppShell is given
 * `key={target.id}` so React REMOUNTS it on every daemon switch — no stale
 * per-session state leaks across targets.
 *
 * DaemonPortProvider is kept (port-keyed hooks under the sessions runtime still
 * consume it) and fed the active target's port.
 */
import { useEffect } from 'react';
import { useConnectionState } from './useConnectionState';
import { daemonWs } from '../lib/daemon/ws-client';
import { installSessionTodosSubscriber } from '@/store/session-todos';
import { installAdapterModelsSubscriber } from '@/store/adapters';
import { seedAdaptersFor } from '@/store/adapters-seed';
import { initLspPort } from '../lib/lsp';
import { DaemonPortProvider } from '../features/sessions/runtime/daemon-port-context';
import { ActiveDaemonProvider, useActiveDaemon } from '../features/daemon/active-daemon-context';
import { AppShell } from './AppShell';
import { ConnectionStatusProvider, useConnectionStatus } from './ConnectionStatusContext';
import { ConnectionOverlay } from './ConnectionOverlay';
import { ThemeEffect } from './ThemeEffect';
import { MfErrorBoundary } from '@/features/shared/MfErrorBoundary';
import { Toaster } from '@/components/ui/sonner';

/**
 * Inner shell — must run inside ActiveDaemonProvider so it can read the active
 * target for the key prop and DaemonPortProvider port.
 *
 * `fallbackPort` is the port resolved by useConnectionState and is used when the
 * active target URL has port 0 (the default singleton value before the first
 * health success seeds it). This ensures the initial local boot path passes the
 * correct port to DaemonPortProvider even when setActiveDaemon hasn't fired yet.
 *
 * Post-boot disconnect overlay lives here (not in App) so useActiveDaemon() is
 * in scope. It is suppressed when the active daemon is REMOTE — the remote case
 * is owned by DaemonFooterStatus's DaemonUnreachableBody overlay.
 */
function DaemonGatedShell({ fallbackPort }: { fallbackPort: number }) {
  const { target } = useActiveDaemon();
  const { state } = useConnectionStatus();
  const parsedUrl = new URL(target.baseUrl);
  const urlPort = parsedUrl.port ? Number(parsedUrl.port) : 0;
  // Fall back to the health-resolved port when the active target URL has port 0
  // (singleton not yet seeded by useConnectionState's first health success).
  const activePort = urlPort > 0 ? urlPort : fallbackPort;

  // Only show the generic reconnect overlay for LOCAL daemon disconnects.
  // REMOTE disconnects are handled by DaemonFooterStatus → DaemonUnreachableBody.
  const showReconnectOverlay = target.kind === 'local' && state !== 'connected';

  // Daemon switch / first port: reset baseline + reseed.
  useEffect(() => {
    if (activePort <= 0) return;
    seedAdaptersFor(activePort);
  }, [activePort]);

  // Transparent reconnect (same-port daemon restart): reseed off the WS reconnect signal —
  // the exact analogue of desktop's loadData-on-subscribeConnection. The [activePort] effect
  // ALONE misses this because useConnectionState's port is set once and never reset on
  // disconnect, and disposeDaemonSession only runs on a user-initiated switch.
  useEffect(
    () =>
      daemonWs.subscribeConnection(() => {
        if (daemonWs.connected && activePort > 0) seedAdaptersFor(activePort);
      }),
    [activePort],
  );

  return (
    <DaemonPortProvider port={activePort}>
      <AppShell key={target.id} port={activePort} />
      <ConnectionOverlay open={showReconnectOverlay} />
    </DaemonPortProvider>
  );
}

export function App() {
  const { state, daemonStatus, port, ready } = useConnectionState();

  // Wire the WS client to the port once available (AppShell's router subscribes).
  // The port useEffect handles the initial local boot connection; switchTo handles
  // subsequent daemon switches.
  useEffect(() => {
    if (port == null) return;
    daemonWs.setPort(port);
    daemonWs.connect();
    // Hand the daemon port to the LSP singleton (constructed with port=0);
    // without this every ensureClient targets ws://127.0.0.1:0 and fails.
    void initLspPort();
  }, [port]);

  // Always-on session-todos subscriber (per-chat TodoWrite list → Context tab).
  // Mounted once so the daemon's resumeChat `todos.updated` seed is never missed.
  useEffect(() => installSessionTodosSubscriber(), []);

  // Always-on adapter-catalog subscriber (adapter.models.updated). Mounted once at the
  // app root so a warm-mount thread updates when the daemon's post-backfill probe fires.
  useEffect(() => installAdapterModelsSubscriber(), []);

  return (
    <MfErrorBoundary>
      <div className="flex h-screen flex-col bg-mf-window text-foreground font-sans">
        <ThemeEffect />
        <ConnectionStatusProvider value={{ state, daemonStatus }}>
          {/* Gate the data shell on `ready` (first successful /health), not merely
              on a known port — the sidecar opens its port before it accepts
              requests, so mounting on port-known alone races the initial REST
              loads. `ready` latches, so a later blip won't unmount the shell. */}
          {ready && port != null ? (
            <ActiveDaemonProvider>
              <DaemonGatedShell fallbackPort={port} />
            </ActiveDaemonProvider>
          ) : (
            <div className="relative flex-1 bg-mf-window">
              <ConnectionOverlay
                open
                embedded
                testId="app-waiting-daemon"
                title="Starting up…"
                subtitle="Connecting to the daemon. This only takes a moment."
              />
            </div>
          )}
        </ConnectionStatusProvider>
        <Toaster />
      </div>
    </MfErrorBoundary>
  );
}
