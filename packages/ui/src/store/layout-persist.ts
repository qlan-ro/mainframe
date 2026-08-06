import { createJSONStorage, type PersistOptions } from 'zustand/middleware';
import { daemonScopedKey } from '@/lib/daemon/daemon-scoped-storage';
import type { LayoutStore, SessionWorkspace } from './layout';
import type { SurfaceId, WorkspaceLayout } from './layout-placement';
import type { RunState, RunTab } from './run-pane';

/**
 * Tab kinds safe to persist: no live PTY/webview ref. `url` qualifies too —
 * its whole identity is a string, so rehydrating it just re-navigates.
 */
export const SAFE_RUN_TAB_KINDS: ReadonlySet<RunTab['kind']> = new Set(['code', 'diff', 'skill', 'viewer', 'url']);

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

const LAYOUT_BASE_KEY = 'mf:session-layout';

/**
 * v1 → v2: the `files` and `run` surfaces merged into one `workspace`, so a
 * persisted placement can name the same surface twice. Fold both ids into
 * `workspace`, dedupe, and drop a bottom strip that now duplicates the top row.
 * Flex weights survive: the merged surface inherits whichever of the two had a
 * weight (`run` wins a tie, being the one that carried the panes).
 *
 * Persisted tabs are kept as-is — they were already sanitized to the file/url
 * kinds on write, and the merged model reads the same `RunTab` shape. Tabs whose
 * `mode` is absent render as permanent, which is the safe default for a tab the
 * user had open.
 */
function migrateLayoutIds(layout: WorkspaceLayout): WorkspaceLayout {
  const fold = (id: string): SurfaceId => (id === 'files' || id === 'run' ? 'workspace' : (id as SurfaceId));
  const top = [...new Set(layout.top.map(fold))];
  const bottom = layout.bottom ? fold(layout.bottom) : null;
  const legacy = layout.topFlex as Partial<Record<string, number>>;
  const topFlex: Partial<Record<SurfaceId, number>> = {};
  if (legacy['chat'] !== undefined) topFlex.chat = legacy['chat'];
  const merged = legacy['run'] ?? legacy['files'];
  if (merged !== undefined) topFlex.workspace = merged;
  return { top, bottom: bottom && top.includes(bottom) ? null : bottom, topFlex, vFlex: layout.vFlex };
}

function migratePersisted(persisted: PersistedLayout | undefined): PersistedLayout {
  const sessions: Record<string, SessionWorkspace> = {};
  for (const [id, ws] of Object.entries(persisted?.sessions ?? {})) {
    sessions[id] = { layout: migrateLayoutIds(ws.layout), run: ws.run };
  }
  return { sessions };
}

/** zustand persist config for the per-session layout store (`mf:session-layout`). */
export const layoutPersistOptions: PersistOptions<LayoutStore, PersistedLayout> = {
  name: LAYOUT_BASE_KEY,
  version: 2,
  migrate: (persisted) => migratePersisted(persisted as PersistedLayout | undefined),
  storage: createJSONStorage(() => ({
    getItem: (name) => localStorage.getItem(daemonScopedKey(name)),
    setItem: (name, value) => localStorage.setItem(daemonScopedKey(name), value),
    removeItem: (name) => localStorage.removeItem(daemonScopedKey(name)),
  })),
  partialize: (s) => ({ sessions: serializeSessions(s.sessions) }),
  merge: (persisted, current) => ({
    ...current,
    sessions: reviveSessions((persisted as PersistedLayout | undefined)?.sessions),
  }),
};
