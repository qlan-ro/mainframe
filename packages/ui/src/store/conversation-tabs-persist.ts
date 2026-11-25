/**
 * The chat and agent tabs of each session's workspace, stored apart from the
 * rest of the layout (`mf:conversation-tabs`). A build from before W9 has no
 * glyph for these kinds and stops rendering at the first one, so the layout it
 * reads must not name them. Such a build never touches this key, so the tabs
 * are still here after another upgrade.
 *
 * Each pane keeps the whole order of its tabs, so a chat tab returns to its
 * place among the files. Everything read back may be missing, malformed or out
 * of step with the layout.
 */
import { CHAT_TAB_ROLES, isConversationTab, MAX_PANES, type RunPane, type RunState, type RunTab } from './run-pane';

interface StoredPane {
  id: string;
  /** Every tab of the pane, left to right, files and terminals included. */
  order: string[];
  tabs: RunTab[];
  /** The tab in front, when it is one of `tabs`. Otherwise the layout knows it. */
  active: string | null;
}

export interface StoredConversations {
  dir: RunState['dir'];
  flex: number[];
  panes: StoredPane[];
}

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

const isRole = (value: unknown): boolean => CHAT_TAB_ROLES.some((role) => role === value);

/** A tab as stored, or null for anything else. A role this build does not know reads as any session's. */
export function readTab(value: unknown): RunTab | null {
  if (!isRecord(value)) return null;
  const { id, kind, title, role } = value;
  if (typeof id !== 'string' || typeof kind !== 'string' || typeof title !== 'string') return null;
  const known = role === undefined || isRole(role) ? value : { ...value, role: 'session' };
  return known as unknown as RunTab;
}

export function readTabs(value: unknown): RunTab[] {
  return Array.isArray(value) ? value.map(readTab).filter((tab): tab is RunTab => tab != null) : [];
}

/** What to store for a session's panes; null when no chat or agent tab is open. */
export function takeConversations(run: RunState | null): StoredConversations | null {
  if (run == null || !run.panes.some((pane) => pane.tabs.some(isConversationTab))) return null;
  const panes = run.panes.map((pane): StoredPane => {
    const tabs = pane.tabs.filter(isConversationTab);
    const active = tabs.some((tab) => tab.id === pane.active) ? pane.active : null;
    return { id: pane.id, order: pane.tabs.map((tab) => tab.id), tabs, active };
  });
  return { dir: run.dir, flex: run.flex, panes };
}

function readPane(value: unknown): StoredPane | null {
  if (!isRecord(value) || typeof value.id !== 'string') return null;
  const tabs = readTabs(value.tabs).filter(isConversationTab);
  const active = tabs.some((tab) => tab.id === value.active) ? (value.active as string) : null;
  return { id: value.id, order: strings(value.order), tabs, active };
}

function joinPane(base: RunPane | undefined, stored: StoredPane): RunPane {
  const held = new Set(base?.tabs.map((tab) => tab.id));
  const rank = (tab: RunTab) => {
    const at = stored.order.indexOf(tab.id);
    return at < 0 ? stored.order.length : at;
  };
  const tabs = [...(base?.tabs ?? []), ...stored.tabs.filter((tab) => !held.has(tab.id))];
  tabs.sort((a, b) => rank(a) - rank(b));
  return { id: stored.id, tabs, active: stored.active ?? base?.active ?? tabs[0]?.id ?? null };
}

/** The panes with their chat and agent tabs back in place. */
export function restoreConversations(run: RunState | null, value: unknown): RunState | null {
  if (!isRecord(value) || !Array.isArray(value.panes)) return run;
  const stored = value.panes.map(readPane).filter((pane): pane is StoredPane => pane != null);
  if (!stored.some((pane) => pane.tabs.length > 0)) return run;

  const known = new Set(stored.map((pane) => pane.id));
  const base = new Map(run?.panes.map((pane) => [pane.id, pane]));
  const joined = stored.map((pane) => joinPane(base.get(pane.id), pane));
  const own = (pane: RunPane) => !base.has(pane.id);
  // Panes opened since, by a build that does not read this key, come first: they are what the user last saw.
  const panes = [...(run?.panes.filter((pane) => !known.has(pane.id)) ?? []), ...joined].filter(
    (pane) => pane.tabs.length > 0,
  );
  while (panes.length > MAX_PANES) {
    const index = panes.map(own).lastIndexOf(true);
    const [extra] = panes.splice(index < 0 ? panes.length - 1 : index, 1);
    panes[0] = { ...panes[0]!, tabs: [...panes[0]!.tabs, ...extra!.tabs] };
  }

  const sameSplit = panes.length === stored.length && panes.every((pane) => known.has(pane.id));
  const flex = sameSplit && Array.isArray(value.flex) ? value.flex : (run?.flex ?? []);
  return {
    dir: sameSplit ? (value.dir === 'h' ? 'h' : 'v') : (run?.dir ?? 'v'),
    flex: panes.map((_, i) => (typeof flex[i] === 'number' ? flex[i] : 1)),
    panes,
  };
}
