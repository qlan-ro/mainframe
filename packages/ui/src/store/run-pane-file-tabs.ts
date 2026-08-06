/**
 * store/run-pane-file-tabs.ts — file-backed tab semantics for the workspace
 * pane model. Pure reducers over `RunState`; the store (`layout.ts`) wires them.
 *
 * These are the rules the retired file tab store owned (mirroring
 * `openTargetWS` in prototype/04-engine.jsx), now expressed per PANE because
 * the workspace can be split:
 *  - opening a file in 'preview' mode replaces that pane's preview tab (at most
 *    one preview tab per pane, per launch scope)
 *  - opening a file that is already open anywhere focuses it (and promotes it
 *    when the caller asked for 'permanent')
 *  - 'permanent' tabs accumulate; a preview never replaces one
 *  - double-clicking a tab, or the first edit, promotes preview → permanent
 */
import {
  activateRunTab,
  closeRunTab,
  emptyRun,
  genId,
  moveTabToRun,
  type RunDropEdge,
  type RunState,
  type RunTab,
  type RunTabKind,
  type TabMode,
} from './run-pane';

/** Kinds backed by a file path, and therefore carrying a preview/permanent mode. */
export type FileTabKind = Extract<RunTabKind, 'code' | 'diff' | 'skill' | 'viewer'>;

const FILE_KINDS: ReadonlySet<RunTabKind> = new Set<RunTabKind>(['code', 'diff', 'skill', 'viewer']);

/** True for a file-backed tab (code/diff/skill/viewer). */
export function isFileTab(tab: RunTab): boolean {
  return FILE_KINDS.has(tab.kind);
}

/**
 * The file tab the workspace treats as focused. With two panes there are two
 * active tabs, so pane order decides: the first pane's active file tab wins.
 * Used for the tree's selected row and the LSP language pick.
 */
export function activeFileTab(run: RunState | null): RunTab | null {
  if (!run) return null;
  for (const pane of run.panes) {
    const active = pane.tabs.find((t) => t.id === pane.active);
    if (active && isFileTab(active)) return active;
  }
  return null;
}

/** What the caller wants opened — the descriptor an `open-file`/`open-diff` intent carries. */
export interface OpenFileTarget {
  kind: FileTabKind;
  path: string;
  title: string;
  /** Pre-resolved diff sides (a chat Edit card); absent means HEAD-vs-working. */
  original?: string;
  modified?: string;
  /** Active session's launch scope, stamped at creation like every other tab. */
  scopeKey?: string;
}

export interface OpenFileTabResult {
  run: RunState;
  /** The tab now focused — existing, replaced, or appended. */
  tabId: string;
}

function buildFileTab(target: OpenFileTarget, mode: TabMode): RunTab {
  const tab: RunTab = {
    id: genId(`tab-${target.kind}`),
    kind: target.kind,
    title: target.title,
    path: target.path,
    mode,
    scopeKey: target.scopeKey,
  };
  if (target.kind === 'diff') return { ...tab, original: target.original, modified: target.modified };
  return tab;
}

/** Identity of an open file tab: kind + path within one launch scope. */
function sameFile(target: OpenFileTarget): (t: RunTab) => boolean {
  return (t) => t.kind === target.kind && t.path === target.path && (t.scopeKey ?? null) === (target.scopeKey ?? null);
}

/**
 * Focus an already-open file tab, promoting it when `mode` is 'permanent' and
 * refreshing a diff's sides so re-opening never shows a stale diff.
 */
function focusExisting(run: RunState, paneId: string, existing: RunTab, target: OpenFileTarget, mode: TabMode) {
  const nextMode: TabMode = mode === 'permanent' ? 'permanent' : (existing.mode ?? 'permanent');
  const patched: RunTab =
    target.kind === 'diff'
      ? { ...existing, mode: nextMode, title: target.title, original: target.original, modified: target.modified }
      : { ...existing, mode: nextMode };
  const panes = run.panes.map((p) =>
    p.id === paneId ? { ...p, tabs: p.tabs.map((t) => (t.id === existing.id ? patched : t)) } : p,
  );
  return { run: activateRunTab({ ...run, panes }, paneId, existing.id), tabId: existing.id };
}

/**
 * Open (or focus) a file tab. `paneId` targets a specific pane; without it — and
 * whenever the named pane is gone — the first pane takes it. Never returns a
 * no-op signal: a file tab has nothing to dispose, so an absent pane falls back
 * rather than dropping the user's open request (unlike `addRunTab`, whose caller
 * owns a live PTY).
 */
export function openFileTab(
  run: RunState | null,
  target: OpenFileTarget,
  mode: TabMode,
  paneId?: string,
): OpenFileTabResult {
  const base = run ?? emptyRun();
  const matches = sameFile(target);

  const holder = base.panes.find((p) => p.tabs.some(matches));
  if (holder) return focusExisting(base, holder.id, holder.tabs.find(matches)!, target, mode);

  const idx = paneId ? base.panes.findIndex((p) => p.id === paneId) : 0;
  const pane = base.panes[idx] ?? base.panes[0]!;
  const tab = buildFileTab(target, mode);
  // One preview slot per pane PER SCOPE: a new preview takes over the pane's
  // current preview tab in place, keeping its position in the strip. Scoping the
  // slot matters because the workspace only shows the active session's tabs — a
  // preview opened in another project must not be silently eaten here.
  const previewIdx =
    mode === 'preview'
      ? pane.tabs.findIndex(
          (t) => isFileTab(t) && t.mode === 'preview' && (t.scopeKey ?? null) === (target.scopeKey ?? null),
        )
      : -1;
  const tabs = previewIdx >= 0 ? pane.tabs.map((t, i) => (i === previewIdx ? tab : t)) : [...pane.tabs, tab];
  const panes = base.panes.map((p) => (p.id === pane.id ? { ...p, tabs, active: tab.id } : p));
  return { run: { ...base, panes }, tabId: tab.id };
}

/**
 * Promote a preview tab to permanent (double-click, or the first edit). Returns
 * the same reference when the tab is unknown or already permanent.
 */
export function promoteFileTab(run: RunState, tabId: string): RunState {
  let changed = false;
  const panes = run.panes.map((p) => ({
    ...p,
    tabs: p.tabs.map((t) => {
      if (t.id !== tabId || t.mode !== 'preview') return t;
      changed = true;
      return { ...t, mode: 'permanent' as TabMode };
    }),
  }));
  return changed ? { ...run, panes } : run;
}

/**
 * Move an OPEN tab to a pane edge (`center` = join the first pane, an edge =
 * split). Detach-then-drop, so the tab keeps its id — and any live webview or
 * PTY bound to that id survives the move. A no-op when the tab is the last one
 * in the workspace: there would be nothing left to split against.
 */
export function moveTabToPaneEdge(run: RunState, tabId: string, edge: RunDropEdge): RunState {
  const from = run.panes.find((p) => p.tabs.some((t) => t.id === tabId));
  const tab = from?.tabs.find((t) => t.id === tabId);
  if (!from || !tab) return run;
  const detached = closeRunTab(run, from.id, tabId);
  if (!detached) return run;
  return moveTabToRun(detached, tab, edge);
}
