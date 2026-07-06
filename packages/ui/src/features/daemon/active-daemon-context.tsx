/**
 * ActiveDaemonContext — React binding for the active daemon singleton.
 *
 * Provides `target` (the current DaemonTarget in React state) and `switchTo`,
 * which runs the full teardown+reconnect sequence:
 *   1. disposeDaemonSession() — disconnect WS, dispose controllers and PTYs.
 *   2. setActiveDaemon(t)     — update the singleton (notifies all listeners).
 *   3. daemonWs.setPort(port) + daemonWs.connect() — reconnect to the new target.
 *   4. rebindLspToActiveDaemon() — flush stale LSP clients and reinit.
 *
 * The daemon-scoped subtree is wrapped with `key={target.id}` in App.tsx so
 * React REMOUNTS it on every switch, ensuring no stale per-session state leaks.
 */
import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import type { DaemonTarget } from '@qlan-ro/mainframe-types';
import { getActiveDaemon, setActiveDaemon, subscribeActiveDaemon } from '@/lib/daemon/active-daemon';
import { setLastDaemonId } from '@/lib/daemon/last-daemon';
import { disposeDaemonSession } from '@/lib/daemon/dispose-daemon-session';
import { daemonWs } from '@/lib/daemon/ws-client';
import { rebindLspToActiveDaemon } from '@/lib/lsp';
import { resetDaemonScopedStores } from './reset-daemon-scoped-stores';

interface ActiveDaemonContextValue {
  target: DaemonTarget;
  switchTo: (t: DaemonTarget) => Promise<void>;
}

const ActiveDaemonContext = createContext<ActiveDaemonContextValue | null>(null);

/**
 * Derive a numeric port from a target URL.
 * Needed to satisfy the daemonWs `port != null` guard before `connect()`.
 * Remote targets without an explicit port in the URL fall back to 443 (https)
 * or 80 (http).
 */
function derivePort(target: DaemonTarget): number {
  const u = new URL(target.baseUrl);
  return u.port ? Number(u.port) : u.protocol === 'https:' ? 443 : 80;
}

interface ActiveDaemonProviderProps {
  children: ReactNode;
  /**
   * Seed the provider with a known initial target instead of reading the
   * singleton. Primarily for testing so test code can control the start state
   * without global singleton contamination.
   */
  initialTarget?: DaemonTarget;
}

export function ActiveDaemonProvider({ children, initialTarget }: ActiveDaemonProviderProps) {
  const [target, setTarget] = useState<DaemonTarget>(() => initialTarget ?? getActiveDaemon());

  useEffect(() => {
    return subscribeActiveDaemon((t) => setTarget(t));
  }, []);

  const switchTo = useCallback(async (t: DaemonTarget): Promise<void> => {
    disposeDaemonSession();
    setActiveDaemon(t);
    // Remember the user's choice so the next launch reconnects to it. Persisted
    // only on an explicit switch — the boot-time local seed does NOT go through
    // switchTo, so it can't clobber a saved remote before restore runs.
    setLastDaemonId(t.id);
    resetDaemonScopedStores();
    try {
      const port = derivePort(t);
      daemonWs.setPort(port);
      daemonWs.connect();
      await rebindLspToActiveDaemon();
    } catch (err) {
      console.warn('[switchTo] reconnect/rebind failed', err);
    }
  }, []);

  return <ActiveDaemonContext.Provider value={{ target, switchTo }}>{children}</ActiveDaemonContext.Provider>;
}

export function useActiveDaemon(): ActiveDaemonContextValue {
  const ctx = useContext(ActiveDaemonContext);
  if (ctx === null) {
    throw new Error('useActiveDaemon must be used within an ActiveDaemonProvider');
  }
  return ctx;
}
