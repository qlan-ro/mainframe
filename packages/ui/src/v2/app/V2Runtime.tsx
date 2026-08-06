/**
 * The daemon runtime the v2 clone renders against.
 *
 * Everything here is imported, never cloned — the clone is a visual rebuild, so
 * the thread list, the REST adapter and the WS router are the shipped ones. Only
 * the port resolution differs: the lab runs in a plain browser tab, with no Tauri
 * host to ask, so it takes `VITE_DAEMON_PORT` the way `lib/tauri/bridge` already
 * does in browser dev mode.
 */
import { useEffect, useMemo, type ReactNode } from 'react';
import { AssistantRuntimeProvider } from '@assistant-ui/react';
import { ConnectionStatusProvider } from '@/app/ConnectionStatusContext';
import { ActiveDaemonProvider, useActiveDaemon } from '@/features/daemon/active-daemon-context';
import { DaemonPortProvider } from '@/features/sessions/runtime/daemon-port-context';
import { useSessionsThreadList } from '@/features/sessions/runtime/use-sessions-thread-list';
import { useSessionListRouter } from '@/features/sessions/ws/use-session-list-router';
import { setActiveDaemon } from '@/lib/daemon/active-daemon';
import { daemonWs } from '@/lib/daemon/ws-client';
import { installAdapterModelsSubscriber } from '@/store/adapters';
import { seedAdaptersFor } from '@/store/adapters-seed';
import { installProviderQuotaSubscriber } from '@/store/quota';
import { seedQuota } from '@/store/quota-seed';
import { useDaemonHealth } from './use-daemon-health';

const DAEMON_PORT = Number((import.meta.env as Record<string, string | undefined>).VITE_DAEMON_PORT) || 31415;

// At module scope, not in an effect: `apiBase()` ignores the port it is handed
// and reads this singleton, and the thread list's first fetch is an effect that
// would otherwise race the seed and resolve against the default port 0.
setActiveDaemon({
  id: 'local',
  kind: 'local',
  label: 'This Mac',
  baseUrl: `http://127.0.0.1:${DAEMON_PORT}`,
  token: null,
});

/** Hook-only child: the router has to run under the provider it reads from. */
function SessionListRouter() {
  useSessionListRouter();
  return null;
}

function ThreadListProvider({ children }: { children: ReactNode }) {
  const runtime = useSessionsThreadList();
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <SessionListRouter />
      {children}
    </AssistantRuntimeProvider>
  );
}

/** Seeds every daemon-scoped catalog for `port`, on mount and on reconnect. */
function useDaemonScopedSeeds(port: number): void {
  useEffect(() => {
    daemonWs.setPort(port);
    daemonWs.connect();
  }, [port]);

  // Without the adapter catalog a new draft can't resolve a model and dies at
  // "adapter claude is unavailable" — the shipped app seeds it above every
  // feature, alongside the quota blobs the footer reads.
  useEffect(() => {
    seedAdaptersFor(port);
    seedQuota(port);
    const unsubscribeModels = installAdapterModelsSubscriber();
    const unsubscribeQuota = installProviderQuotaSubscriber();
    // A same-port daemon restart never changes the port, so the seed above can't
    // re-fire on its own; the reconnect signal is the only re-seed trigger.
    const unsubscribeConnection = daemonWs.subscribeConnection(() => {
      if (!daemonWs.connected) return;
      seedAdaptersFor(port);
      seedQuota(port);
    });
    return () => {
      unsubscribeModels();
      unsubscribeQuota();
      unsubscribeConnection();
    };
  }, [port]);
}

/**
 * Everything below the active daemon. Keyed by `target.id` in the parent, so a
 * switch remounts the whole subtree rather than leaking per-session state.
 */
function DaemonScope({ children }: { children: ReactNode }) {
  const { target } = useActiveDaemon();
  const port = useMemo(() => Number(new URL(target.baseUrl).port) || DAEMON_PORT, [target.baseUrl]);
  const state = useDaemonHealth();

  useDaemonScopedSeeds(port);

  // daemonStatus mirrors the poll: the lab has no host to report a supervisor state.
  return (
    <ConnectionStatusProvider value={{ state, daemonStatus: state }}>
      <DaemonPortProvider port={port}>
        <ThreadListProvider>{children}</ThreadListProvider>
      </DaemonPortProvider>
    </ConnectionStatusProvider>
  );
}

function KeyedDaemonScope({ children }: { children: ReactNode }) {
  const { target } = useActiveDaemon();
  return <DaemonScope key={target.id}>{children}</DaemonScope>;
}

export function V2Runtime({ children }: { children: ReactNode }) {
  return (
    <ActiveDaemonProvider>
      <KeyedDaemonScope>{children}</KeyedDaemonScope>
    </ActiveDaemonProvider>
  );
}
