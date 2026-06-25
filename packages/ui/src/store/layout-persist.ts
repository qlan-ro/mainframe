import { createJSONStorage, type PersistOptions } from 'zustand/middleware';
import type { LayoutStore, SessionWorkspace } from './layout';
import type { RunState, RunTab } from './run-pane';

/** File-backed tab kinds that are safe to persist (no live PTY/webview ref). */
export const SAFE_RUN_TAB_KINDS: ReadonlySet<RunTab['kind']> = new Set(['code', 'diff', 'skill', 'viewer']);

/**
 * Keep only file-backed tabs; drop empty panes; null the run if nothing
 * survives. Prevents dead PTY/webview handles from being rehydrated.
 */
export function sanitizeRun(run: RunState | null): RunState | null {
  if (!run) return null;
  const panes = run.panes
    .map((p) => {
      const tabs = p.tabs.filter((t) => SAFE_RUN_TAB_KINDS.has(t.kind));
      const active = tabs.some((t) => t.id === p.active) ? p.active : (tabs[0]?.id ?? null);
      return { ...p, tabs, active };
    })
    .filter((p) => p.tabs.length > 0);
  if (panes.length === 0) return null;
  return { ...run, panes, flex: panes.map((_, i) => run.flex[i] ?? 1) };
}

/**
 * Serialize the sessions Map to a plain object for persistence.
 * Sanitizes run tabs, skips volatile __LOCALID_* draft sessions.
 */
export function serializeSessions(sessions: Map<string, SessionWorkspace>): Record<string, SessionWorkspace> {
  const out: Record<string, SessionWorkspace> = {};
  for (const [id, ws] of sessions) {
    if (id.startsWith('__LOCALID_')) continue;
    out[id] = { layout: ws.layout, run: sanitizeRun(ws.run) };
  }
  return out;
}

/**
 * Revive a persisted plain object back to a Map on rehydrate.
 */
export function reviveSessions(obj: Record<string, SessionWorkspace> | undefined): Map<string, SessionWorkspace> {
  return new Map(Object.entries(obj ?? {}));
}

/** Drop persisted entries whose id is no longer a live chat; identity-stable when nothing changed. */
export function prunePersistedSessions(
  sessions: Map<string, SessionWorkspace>,
  validIds: Set<string>,
): Map<string, SessionWorkspace> {
  const next = new Map([...sessions].filter(([id]) => validIds.has(id)));
  return next.size === sessions.size ? sessions : next;
}

type PersistedLayout = { sessions: Record<string, SessionWorkspace> };

/** zustand persist config for the per-session layout store (`mf:session-layout`). */
export const layoutPersistOptions: PersistOptions<LayoutStore, PersistedLayout> = {
  name: 'mf:session-layout',
  version: 1,
  storage: createJSONStorage(() => localStorage),
  partialize: (s) => ({ sessions: serializeSessions(s.sessions) }),
  merge: (persisted, current) => ({
    ...current,
    sessions: reviveSessions((persisted as PersistedLayout | undefined)?.sessions),
  }),
};
