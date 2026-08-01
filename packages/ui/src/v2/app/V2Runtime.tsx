/**
 * The daemon runtime the v2 clone renders against.
 *
 * Everything here is imported, never cloned — the clone is a visual rebuild, so
 * the thread list, the REST adapter and the WS router are the shipped ones. Only
 * the port resolution differs: the lab runs in a plain browser tab, with no Tauri
 * host to ask, so it takes `VITE_DAEMON_PORT` the way `lib/tauri/bridge` already
 * does in browser dev mode.
 */
import { useEffect, type ReactNode } from 'react';
import { AssistantRuntimeProvider } from '@assistant-ui/react';
import { DaemonPortProvider } from '@/features/sessions/runtime/daemon-port-context';
import { useSessionsThreadList } from '@/features/sessions/runtime/use-sessions-thread-list';
import { useSessionListRouter } from '@/features/sessions/ws/use-session-list-router';
import { setActiveDaemon } from '@/lib/daemon/active-daemon';
import { daemonWs } from '@/lib/daemon/ws-client';
import { installAdapterModelsSubscriber } from '@/store/adapters';
import { seedAdaptersFor } from '@/store/adapters-seed';

const DAEMON_PORT = Number((import.meta.env as Record<string, string | undefined>).VITE_DAEMON_PORT) || 31415;

// At module scope, not in an effect: `apiBase()` ignores the port it is handed
// and reads this singleton, and the thread list's first fetch is an effect that
// would otherwise race the seed and resolve against the default port 0.
setActiveDaemon({
  id: 'local',
  kind: 'local',
  label: 'Local',
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

export function V2Runtime({ children }: { children: ReactNode }) {
  useEffect(() => {
    daemonWs.setPort(DAEMON_PORT);
    daemonWs.connect();
  }, []);

  // The adapter catalog, seeded once and kept fresh off the WS. Without it a new
  // draft can't resolve a model and dies at "adapter claude is unavailable" —
  // the shipped app seeds it at the root, above every feature.
  useEffect(() => {
    seedAdaptersFor(DAEMON_PORT);
    const unsubscribeModels = installAdapterModelsSubscriber();
    // A same-port daemon restart never changes the port, so the seed above can't
    // re-fire on its own; the reconnect signal is the only re-seed trigger.
    const unsubscribeConnection = daemonWs.subscribeConnection(() => {
      if (daemonWs.connected) seedAdaptersFor(DAEMON_PORT);
    });
    return () => {
      unsubscribeModels();
      unsubscribeConnection();
    };
  }, []);

  return (
    <DaemonPortProvider port={DAEMON_PORT}>
      <ThreadListProvider>{children}</ThreadListProvider>
    </DaemonPortProvider>
  );
}
