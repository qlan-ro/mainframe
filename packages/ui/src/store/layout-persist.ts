import type { PersistOptions, PersistStorage, StorageValue } from 'zustand/middleware';
import { daemonScopedKey } from '@/lib/daemon/daemon-scoped-storage';
import {
  isRecord,
  readTabs,
  restoreConversations,
  takeConversations,
  type StoredConversations,
} from './conversation-tabs-persist';
import type { LayoutStore, SessionWorkspace } from './layout';
import { placeInLayout, type SurfaceId, type WorkspaceLayout } from './layout-placement';
import { isConversationTab, type RunPane, type RunState, type RunTab } from './run-pane';

/**
 * Tab kinds that survive a restart: no live PTY/webview ref. `url` qualifies too —
 * its whole identity is a string, so rehydrating it just re-navigates. So do
 * `chat` and `agent`: ids the daemon still knows, re-attached on mount. Anything
 * else read back, a newer build's kind included, is dropped.
 */
const SAFE_RUN_TAB_KINDS: ReadonlySet<RunTab['kind']> = new Set([
  'code',
  'diff',
  'skill',
  'viewer',
  'url',
  'chat',
  'agent',
]);

/**
 * Keep only the tabs to keep; drop empty panes; null the run if nothing
 * survives. Prevents dead PTY/webview handles from being rehydrated.
 */
function keepTabs(run: RunState | null, keep: (tab: RunTab) => boolean): RunState | null {
  if (!run) return null;
  const panes = run.panes
    .map((p) => {
      const tabs = p.tabs.filter(keep);
      const active = tabs.some((t) => t.id === p.active) ? p.active : (tabs[0]?.id ?? null);
      return { ...p, tabs, active };
    })
    .filter((p) => p.tabs.length > 0);
  if (panes.length === 0) return null;
  return { ...run, panes, flex: panes.map((_, i) => run.flex[i] ?? 1) };
}

/** The tabs that survive a restart. */
export function sanitizeRun(run: RunState | null): RunState | null {
  return keepTabs(run, (tab) => SAFE_RUN_TAB_KINDS.has(tab.kind));
}

/** A local (uncommitted) new-thread draft id — never persisted or GC-exempt by daemon id. */
export function isDraftSessionId(id: string): boolean {
  return id.startsWith('__LOCALID_');
}

/** A layout as every build since v2 reads it. The bottom strip is gone (W9), so it is always empty. */
interface StoredLayout extends WorkspaceLayout {
  bottom: null;
  vFlex: { top: number; bottom: number };
}

interface StoredSession {
  layout: StoredLayout;
  run: RunState | null;
}

const NO_BOTTOM_STRIP = { bottom: null, vFlex: { top: 1, bottom: 0.4 } } as const;

/**
 * Serialize the sessions Map to a plain object for persistence, without the chat
 * and agent tabs (`conversation-tabs-persist`).
 * Sanitizes run tabs, skips volatile __LOCALID_* draft sessions.
 */
export function serializeSessions(sessions: Map<string, SessionWorkspace>): Record<string, StoredSession> {
  const out: Record<string, StoredSession> = {};
  for (const [id, ws] of sessions) {
    if (isDraftSessionId(id)) continue;
    const run = keepTabs(ws.run, (tab) => SAFE_RUN_TAB_KINDS.has(tab.kind) && !isConversationTab(tab));
    out[id] = { layout: { ...ws.layout, ...NO_BOTTOM_STRIP }, run };
  }
  return out;
}

function serializeConversations(sessions: Map<string, SessionWorkspace>): Record<string, StoredConversations> {
  const out: Record<string, StoredConversations> = {};
  for (const [id, ws] of sessions) {
    const conversations = isDraftSessionId(id) ? null : takeConversations(sanitizeRun(ws.run));
    if (conversations) out[id] = conversations;
  }
  return out;
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

interface PersistedLayout {
  sessions: Record<string, StoredSession>;
  /** By session, in a storage key of its own. */
  conversations: Record<string, StoredConversations>;
}

const LAYOUT_BASE_KEY = 'mf:session-layout';
const CONVERSATIONS_BASE_KEY = 'mf:conversation-tabs';

/**
 * Any released placement → the current one.
 *
 * - v1: the `files` and `run` surfaces merged into one `workspace`, so a
 *   placement can name the same surface twice. Flex weights survive: the merged
 *   surface inherits whichever of the two had one (`run` wins a tie, being the
 *   one that carried the panes).
 * - The bottom strip is gone. Nothing but the chat split ever put the workspace
 *   there (it parked it to free the width), and split chats are retired (W9), so
 *   it returns beside the chat, still lit.
 *
 * Tabs whose `mode` is absent render as permanent, the safe default for a tab
 * the user had open.
 */
function readLayout(value: unknown): WorkspaceLayout {
  const { top, bottom, topFlex } = isRecord(value) ? value : {};
  const surface = (id: unknown): SurfaceId | null => {
    if (id === 'chat') return 'chat';
    return id === 'workspace' || id === 'run' || id === 'files' ? 'workspace' : null;
  };
  const lit = [...(Array.isArray(top) ? top : []), bottom].map(surface).filter((id): id is SurfaceId => id != null);
  const stored = isRecord(topFlex) ? topFlex : {};
  const weight = (...ids: string[]) => ids.map((id) => stored[id]).find((flex) => typeof flex === 'number');
  const flex: Partial<Record<SurfaceId, number>> = {};
  const chat = weight('chat');
  if (chat !== undefined) flex.chat = chat;
  const workspace = weight('workspace', 'run', 'files');
  if (workspace !== undefined) flex.workspace = workspace;
  return (lit.length > 0 ? lit : (['chat'] as const)).reduce<WorkspaceLayout>(placeInLayout, {
    top: [],
    topFlex: flex,
  });
}

function readPane(value: unknown): RunPane | null {
  if (!isRecord(value) || typeof value.id !== 'string') return null;
  return {
    id: value.id,
    tabs: readTabs(value.tabs),
    active: typeof value.active === 'string' ? value.active : null,
  };
}

function readRun(value: unknown): RunState | null {
  if (!isRecord(value) || !Array.isArray(value.panes)) return null;
  const panes = value.panes.map(readPane).filter((pane): pane is RunPane => pane != null);
  const flex = Array.isArray(value.flex) ? value.flex.filter((n): n is number => typeof n === 'number') : [];
  return sanitizeRun({ dir: value.dir === 'h' ? 'h' : 'v', flex, panes });
}

/**
 * The sessions as any build stored them. An entry that can't be read costs only
 * itself: the next write replaces the whole record, so one that threw would take
 * every session's layout with it.
 */
export function reviveSessions(stored: unknown, conversations?: unknown): Map<string, SessionWorkspace> {
  const sessions = new Map<string, SessionWorkspace>();
  const tabs = isRecord(conversations) ? conversations : {};
  for (const [id, entry] of Object.entries(isRecord(stored) ? stored : {})) {
    if (!isRecord(entry)) continue;
    sessions.set(id, { layout: readLayout(entry.layout), run: restoreConversations(readRun(entry.run), tabs[id]) });
  }
  return sessions;
}

function readConversations(): unknown {
  const raw = localStorage.getItem(daemonScopedKey(CONVERSATIONS_BASE_KEY));
  if (raw == null) return {};
  try {
    return JSON.parse(raw);
  } catch (error) {
    console.warn('[layout] could not read the chat tabs', error);
    return {};
  }
}

/** Two keys, one state: an older build reads the first and never sees the second. */
const layoutStorage: PersistStorage<PersistedLayout> = {
  getItem(name) {
    const raw = localStorage.getItem(daemonScopedKey(name));
    if (raw == null) return null;
    const { state, version } = JSON.parse(raw) as StorageValue<PersistedLayout>;
    const conversations = readConversations() as PersistedLayout['conversations'];
    return { state: { sessions: state?.sessions, conversations }, version };
  },
  setItem(name, { state: { sessions, conversations }, version }) {
    localStorage.setItem(daemonScopedKey(name), JSON.stringify({ state: { sessions }, version }));
    localStorage.setItem(daemonScopedKey(CONVERSATIONS_BASE_KEY), JSON.stringify(conversations));
  },
  removeItem(name) {
    localStorage.removeItem(daemonScopedKey(name));
    localStorage.removeItem(daemonScopedKey(CONVERSATIONS_BASE_KEY));
  },
};

/**
 * zustand persist config for the per-session layout store (`mf:session-layout`).
 * Still v2, the version older builds wrote: what is stored is a layout they read
 * as it is, and every read here goes through `reviveSessions`, whichever version
 * wrote it.
 */
export const layoutPersistOptions: PersistOptions<LayoutStore, PersistedLayout> = {
  name: LAYOUT_BASE_KEY,
  version: 2,
  migrate: (persisted) => persisted as PersistedLayout,
  storage: layoutStorage,
  partialize: (s) => ({
    sessions: serializeSessions(s.sessions),
    conversations: serializeConversations(s.sessions),
  }),
  merge: (persisted, current) => {
    const { sessions, conversations } = isRecord(persisted) ? persisted : {};
    return { ...current, sessions: reviveSessions(sessions, conversations) };
  },
};
