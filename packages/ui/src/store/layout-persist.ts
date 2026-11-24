import { createJSONStorage, type PersistOptions } from 'zustand/middleware';
import { daemonScopedKey } from '@/lib/daemon/daemon-scoped-storage';
import type { LayoutStore, SessionWorkspace } from './layout';
import { placeInLayout, type SurfaceId, type WorkspaceLayout } from './layout-placement';
import type { RunState, RunTab } from './run-pane';

/**
 * Tab kinds safe to persist: no live PTY/webview ref. `url` qualifies too —
 * its whole identity is a string, so rehydrating it just re-navigates. So do
 * `chat` and `agent`: ids the daemon still knows, re-attached on mount.
 */
export const SAFE_RUN_TAB_KINDS: ReadonlySet<RunTab['kind']> = new Set([
  'code',
  'diff',
  'skill',
  'viewer',
  'url',
  'chat',
  'agent',
]);

/**
 * Keep only tabs that survive a restart; drop empty panes; null the run if nothing
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

/** A local (uncommitted) new-thread draft id — never persisted or GC-exempt by daemon id. */
export function isDraftSessionId(id: string): boolean {
  return id.startsWith('__LOCALID_');
}

/**
 * Serialize the sessions Map to a plain object for persistence.
 * Sanitizes run tabs, skips volatile __LOCALID_* draft sessions.
 */
export function serializeSessions(sessions: Map<string, SessionWorkspace>): Record<string, SessionWorkspace> {
  const out: Record<string, SessionWorkspace> = {};
  for (const [id, ws] of sessions) {
    if (isDraftSessionId(id)) continue;
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

/**
 * Drop persisted entries whose id is no longer a live chat; identity-stable when
 * nothing changed. Exempts the active draft (no daemon id to appear in
 * `validIds` yet) so the router's frequent re-runs never wipe it off screen.
 */
export function prunePersistedSessions(
  sessions: Map<string, SessionWorkspace>,
  validIds: Set<string>,
  activeSessionId?: string | null,
): Map<string, SessionWorkspace> {
  const keep = (id: string) => validIds.has(id) || (id === activeSessionId && isDraftSessionId(id));
  const next = new Map([...sessions].filter(([id]) => keep(id)));
  return next.size === sessions.size ? sessions : next;
}

type PersistedLayout = { sessions: Record<string, SessionWorkspace> };

const LAYOUT_BASE_KEY = 'mf:session-layout';

/** A layout as any released version wrote it: surface ids and the bottom strip have both changed since. */
interface LegacyLayout {
  top: string[];
  bottom?: string | null;
  topFlex?: Partial<Record<string, number>>;
}

/**
 * Any older placement → the current one.
 *
 * - v1 → v2: the `files` and `run` surfaces merged into one `workspace`, so a
 *   placement can name the same surface twice. Flex weights survive: the merged
 *   surface inherits whichever of the two had one (`run` wins a tie, being the
 *   one that carried the panes).
 * - v2 → v3: the bottom strip is gone. Nothing but the chat split ever put the
 *   workspace there (it parked it to free the width), and split chats are
 *   retired (W9), so it returns beside the chat, still lit.
 *
 * Persisted tabs are kept as-is — they were already sanitized on write, and every version reads the same `RunTab` shape. Tabs whose
 * `mode` is absent render as permanent, the safe default for a tab the user had open.
 */
function migrateLayout(layout: LegacyLayout): WorkspaceLayout {
  const surface = (id: string): SurfaceId => (id === 'chat' ? 'chat' : 'workspace');
  const lit = [...layout.top, ...(layout.bottom ? [layout.bottom] : [])].map(surface);
  const legacy = layout.topFlex ?? {};
  const topFlex: Partial<Record<SurfaceId, number>> = {};
  if (legacy['chat'] !== undefined) topFlex.chat = legacy['chat'];
  const workspace = legacy['workspace'] ?? legacy['run'] ?? legacy['files'];
  if (workspace !== undefined) topFlex.workspace = workspace;
  return lit.reduce<WorkspaceLayout>(placeInLayout, { top: [], topFlex });
}

function migratePersisted(persisted: PersistedLayout | undefined): PersistedLayout {
  const sessions: Record<string, SessionWorkspace> = {};
  for (const [id, ws] of Object.entries(persisted?.sessions ?? {})) {
    sessions[id] = { layout: migrateLayout(ws.layout as LegacyLayout), run: ws.run };
  }
  return { sessions };
}

/** zustand persist config for the per-session layout store (`mf:session-layout`). */
export const layoutPersistOptions: PersistOptions<LayoutStore, PersistedLayout> = {
  name: LAYOUT_BASE_KEY,
  version: 3,
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
