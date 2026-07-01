/**
 * useDaemonRegistry — lists all known daemons (local synthetic + persisted
 * remotes) and provides mutations: add, rename, remove, switchTo.
 *
 * The synthetic "local" entry is never persisted; it is always prepended to the
 * list derived from getHost().daemons.list().  Mutations reload the remote list
 * so callers always see consistent state.
 *
 * Pattern mirrors useProjects (useState + effect keyed by port, reload on demand).
 */
import { useEffect, useCallback, useMemo, useSyncExternalStore } from 'react';
import type { DaemonMeta, DaemonTarget } from '@qlan-ro/mainframe-types';
import { getHost } from '@/lib/host';
import { parseRemoteUrl } from './pair-daemon';
import { useDaemonPort } from '@/features/sessions/runtime/daemon-port-context';
import { useActiveDaemon } from './active-daemon-context';

export interface UseDaemonRegistryResult {
  daemons: DaemonMeta[];
  activeId: string;
  reload(): Promise<void>;
  add(meta: DaemonMeta, token: string): Promise<void>;
  rename(id: string, label: string): Promise<void>;
  remove(id: string): Promise<void>;
  switchTo(id: string): Promise<void>;
}

function buildSyntheticLocal(port: number): DaemonMeta {
  return { id: 'local', kind: 'local', label: 'This Mac', host: `127.0.0.1:${port}` };
}

function buildLocalTarget(port: number): DaemonTarget {
  return { id: 'local', kind: 'local', label: 'This Mac', baseUrl: `http://127.0.0.1:${port}`, token: null };
}

async function buildRemoteTarget(meta: DaemonMeta): Promise<DaemonTarget> {
  const token = await getHost().daemons.getToken(meta.id);
  const { baseUrl } = parseRemoteUrl(`https://${meta.host}`);
  return { id: meta.id, kind: 'remote', label: meta.label, baseUrl, token };
}

// The remote list is shared across ALL useDaemonRegistry consumers (mirrors the
// active-daemon singleton pattern) so a mutation in one surface — e.g. add() in
// the Add-remote dialog — is reflected everywhere — e.g. the footer picker —
// immediately, without waiting for a reload/remount. Per-component useState made
// each call site independent, so a paired daemon stayed invisible until reload.
let remotesSnapshot: DaemonMeta[] = [];
const remotesListeners = new Set<() => void>();
function subscribeRemotes(cb: () => void): () => void {
  remotesListeners.add(cb);
  return () => {
    remotesListeners.delete(cb);
  };
}
async function loadRemotes(): Promise<void> {
  try {
    remotesSnapshot = await getHost().daemons.list();
    remotesListeners.forEach((l) => l());
  } catch (e: unknown) {
    console.warn('[useDaemonRegistry] daemons.list failed', e);
  }
}

export function useDaemonRegistry(): UseDaemonRegistryResult {
  const port = useDaemonPort();
  const { target, switchTo: contextSwitchTo } = useActiveDaemon();
  const remotes = useSyncExternalStore(subscribeRemotes, () => remotesSnapshot);

  const reload = useCallback((): Promise<void> => loadRemotes(), []);

  useEffect(() => {
    void loadRemotes();
  }, [port]);

  const daemons = useMemo<DaemonMeta[]>(() => [buildSyntheticLocal(port), ...remotes], [port, remotes]);

  const add = useCallback(
    async (meta: DaemonMeta, token: string): Promise<void> => {
      await getHost().daemons.upsert(meta);
      await getHost().daemons.setToken(meta.id, token);
      await reload();
    },
    [reload],
  );

  const rename = useCallback(
    async (id: string, label: string): Promise<void> => {
      const existing = remotes.find((m) => m.id === id);
      if (existing == null) {
        console.warn('[useDaemonRegistry] rename: unknown id', id);
        return;
      }
      await getHost().daemons.upsert({ ...existing, label });
      await reload();
    },
    [remotes, reload],
  );

  const remove = useCallback(
    async (id: string): Promise<void> => {
      await getHost().daemons.remove(id);
      if (target.id === id) {
        await contextSwitchTo(buildLocalTarget(port));
      }
      await reload();
    },
    [target.id, port, contextSwitchTo, reload],
  );

  const switchTo = useCallback(
    async (id: string): Promise<void> => {
      let resolved: DaemonTarget;
      if (id === 'local') {
        resolved = buildLocalTarget(port);
      } else {
        const meta = remotes.find((m) => m.id === id);
        if (meta == null) {
          console.warn('[useDaemonRegistry] switchTo: unknown id', id);
          return;
        }
        resolved = await buildRemoteTarget(meta);
      }
      await contextSwitchTo(resolved);
    },
    [port, remotes, contextSwitchTo],
  );

  return {
    daemons,
    activeId: target.id,
    reload,
    add,
    rename,
    remove,
    switchTo,
  };
}
