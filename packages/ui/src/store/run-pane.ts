/**
 * store/run-pane.ts — the workspace surface's multi-pane model.
 *
 * The workspace holds 1–2 panes laid out along an axis (`dir`), each pane a tab
 * strip. Every tab kind lives here — launched previews/consoles, terminals, URL
 * tabs, and file-backed tabs (code/diff/skill/viewer) — since the Files and Run
 * surfaces merged into one. All functions are PURE; the store (`layout.ts`) owns
 * the wiring + side-effects. File-tab open/promote semantics live beside this in
 * `run-pane-file-tabs.ts`.
 */

export type RunTabKind = 'preview' | 'console' | 'terminal' | 'code' | 'diff' | 'skill' | 'viewer' | 'url';

/** Preview = the single italic replace-me slot per pane; permanent = pinned. File tabs only. */
export type TabMode = 'preview' | 'permanent';

/** A tab inside a workspace pane (a launched preview/console, a terminal, a file, or a URL tab). */
export interface RunTab {
  id: string;
  kind: RunTabKind;
  title: string;
  /** File path for code/diff/skill/viewer tabs; absent for preview/console/terminal/url. */
  path?: string;
  /** Launch-config name for preview (webview) and console (process) tabs. */
  config?: string;
  /** Resolved dev-server port for a preview tab (the webview loads localhost:port). */
  port?: number;
  /** Normalized address for a `url` tab (http/https only — see normalizePreviewUrl). */
  url?: string;
  /** Preview/permanent slot for file-backed tabs; absent on every other kind. */
  mode?: TabMode;
  /** Pre-resolved diff sides for a `diff` tab; absent means HEAD-vs-working. */
  original?: string;
  modified?: string;
  /**
   * Launch scope this tab belongs to (`buildLaunchScope(projectId,
   * effectivePath)`), captured at creation from the active session. Workspace
   * tabs are global (not bound to the active chat), so each carries its own
   * scope: launch tabs filter their console/status by it, and the workspace
   * shows only the tabs matching the active session's scope (so they don't leak
   * across projects/worktrees). Stamped on EVERY tab — launch configs,
   * terminals, and files — from the active session; only absent on a
   * draft/unresolved session (no scope yet).
   */
  scopeKey?: string;
}

/** A launch-config tab — a `preview` webview or a `console` process. */
function isLaunchTab(t: RunTab): boolean {
  return t.kind === 'preview' || t.kind === 'console';
}

/**
 * A predicate matching the existing tab `addRunTab` should focus instead of
 * duplicating, or `null` when `tab` has no dedup identity. Launch tabs dedup by
 * `config` + `scopeKey`; `url` tabs dedup by exact (already-normalized) `url` +
 * `scopeKey` — same shape, different identity field.
 */
function dedupMatcher(tab: RunTab): ((t: RunTab) => boolean) | null {
  if (isLaunchTab(tab) && tab.config) {
    return (t) => isLaunchTab(t) && t.config === tab.config && t.scopeKey === tab.scopeKey;
  }
  if (tab.kind === 'url' && tab.url) {
    return (t) => t.kind === 'url' && t.url === tab.url && t.scopeKey === tab.scopeKey;
  }
  return null;
}

export interface RunPane {
  id: string;
  tabs: RunTab[];
  active: string | null;
}

export interface RunState {
  /** 'v' = panes side-by-side; 'h' = panes stacked. */
  dir: 'v' | 'h';
  /** Flex weights per pane (length matches `panes`). */
  flex: number[];
  panes: RunPane[];
}

/** Where a dragged tab lands on the workspace region. */
export type RunDropEdge = 'center' | 'left' | 'right' | 'top' | 'bottom';

const MAX_PANES = 2;

export function genId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}

/** A workspace with one empty pane. */
export function emptyRun(): RunState {
  return { dir: 'v', flex: [1, 1], panes: [{ id: genId('pane'), tabs: [], active: null }] };
}

/**
 * Append a tab to a pane and focus it. With no `paneId`, targets the first pane
 * (back-compat) and creates the workspace state if absent. Returns a new `RunState` on
 * success. Returns `null` to signal an explicit no-op — the given `paneId` no
 * longer exists — so the caller disposes the orphan terminal; never silently
 * falls back to pane 0 (M6). `null` is the unambiguous no-op signal: it does not
 * rely on reference equality, which a fresh `emptyRun()` would defeat when `run`
 * was `null` and the target pane was missing.
 */
export function addRunTab(run: RunState | null, tab: RunTab, paneId?: string): RunState | null {
  const base = run ?? emptyRun();
  // Launch-config tabs (preview webview OR console process) and url tabs are
  // singletons per identity WITHIN a launch scope: if one already exists (in
  // any pane), focus it instead of stacking a duplicate — the run button
  // re-launches the same config repeatedly, and typing the same address twice
  // shouldn't open a second webview. Different scopes get their own tab. This
  // is the "or activates" half of addRunTab.
  const matcher = dedupMatcher(tab);
  if (matcher) {
    const pane = base.panes.find((p) => p.tabs.some(matcher));
    if (pane) {
      const existing = pane.tabs.find(matcher)!;
      return activateRunTab(base, pane.id, existing.id);
    }
  }
  let idx: number;
  if (paneId) {
    idx = base.panes.findIndex((p) => p.id === paneId);
    if (idx < 0) return null; // explicit target gone → no-op
  } else {
    idx = 0;
  }
  const target = base.panes[idx];
  if (!target) return null; // no pane to append to → no-op
  const nextPane: RunPane = { ...target, tabs: [...target.tabs, tab], active: tab.id };
  const panes = base.panes.map((p, i) => (i === idx ? nextPane : p));
  return { ...base, panes };
}

/** Focus a tab in a pane. */
export function activateRunTab(run: RunState, paneId: string, tabId: string): RunState {
  return {
    ...run,
    panes: run.panes.map((p) => (p.id === paneId ? { ...p, active: tabId } : p)),
  };
}

/**
 * Remove a tab from a pane; drop any pane left empty. Returns `null` when the
 * whole workspace is now empty (caller closes the workspace surface).
 */
export function closeRunTab(run: RunState, paneId: string, tabId: string): RunState | null {
  const panes = run.panes
    .map((p) => {
      if (p.id !== paneId) return p;
      const tabs = p.tabs.filter((t) => t.id !== tabId);
      const active = p.active === tabId ? (tabs[tabs.length - 1]?.id ?? null) : p.active;
      return { ...p, tabs, active };
    })
    .filter((p) => p.tabs.length > 0);
  if (panes.length === 0) return null;
  return { ...run, panes, flex: panes.length === 1 ? [1, 1] : run.flex };
}

/**
 * Close a whole pane (un-split). Returns `null` when no panes remain.
 */
export function closePane(run: RunState, paneId: string): RunState | null {
  const panes = run.panes.filter((p) => p.id !== paneId);
  if (panes.length === 0) return null;
  return { ...run, panes, flex: [1, 1] };
}

/** Every tab id of `kind` in the workspace state (across all panes). */
export function tabIdsInRun(run: RunState | null, kind: RunTabKind): string[] {
  if (!run) return [];
  return run.panes.flatMap((p) => p.tabs.filter((t) => t.kind === kind).map((t) => t.id));
}

/** Tab ids of `kind` in a single pane. */
export function tabIdsInPane(run: RunState | null, paneId: string, kind: RunTabKind): string[] {
  if (!run) return [];
  const pane = run.panes.find((p) => p.id === paneId);
  if (!pane) return [];
  return pane.tabs.filter((t) => t.kind === kind).map((t) => t.id);
}

/** Tab ids of `kind` belonging to a launch scope (across all panes). */
export function tabIdsForScope(run: RunState | null, scopeKey: string, kind: RunTabKind): string[] {
  if (!run) return [];
  return run.panes.flatMap((p) => p.tabs.filter((t) => t.kind === kind && t.scopeKey === scopeKey).map((t) => t.id));
}

/**
 * Remove every tab of a launch scope (across all panes); drop any pane left
 * empty. A pane whose active tab was removed re-points to its last survivor.
 * Returns `null` when the whole workspace is now empty. Mirrors closeRunTab's
 * flex reset on collapse to a single pane.
 */
export function releaseRunScope(run: RunState, scopeKey: string): RunState | null {
  const panes = run.panes
    .map((p) => {
      const tabs = p.tabs.filter((t) => t.scopeKey !== scopeKey);
      const active = tabs.some((t) => t.id === p.active) ? p.active : (tabs[tabs.length - 1]?.id ?? null);
      return { ...p, tabs, active };
    })
    .filter((p) => p.tabs.length > 0);
  if (panes.length === 0) return null;
  return { ...run, panes, flex: panes.length === 1 ? [1, 1] : run.flex };
}

/**
 * Point a `url` tab at a new address (the address bar navigated in place). If a
 * sibling tab in the same scope already holds the target URL, activate that
 * sibling instead of creating a duplicate and leave the source tab untouched —
 * mirrors addRunTab's dedup-or-activate rule for the in-place case. Returns the
 * same `run` reference for a no-op: unknown `tabId`, a non-`url` tab, or
 * retargeting to the URL the tab already holds.
 */
export function retargetUrlTab(run: RunState, tabId: string, url: string, title: string): RunState {
  const sourcePane = run.panes.find((p) => p.tabs.some((t) => t.id === tabId));
  const source = sourcePane?.tabs.find((t) => t.id === tabId);
  if (!sourcePane || !source || source.kind !== 'url' || source.url === url) return run;

  const holds = (t: RunTab): boolean => t.kind === 'url' && t.url === url && t.scopeKey === source.scopeKey;
  const holderPane = run.panes.find((p) => p.tabs.some(holds));
  if (holderPane) return activateRunTab(run, holderPane.id, holderPane.tabs.find(holds)!.id);

  const panes = run.panes.map((p) =>
    p.id === sourcePane.id ? { ...p, tabs: p.tabs.map((t) => (t.id === tabId ? { ...t, url, title } : t)) } : p,
  );
  return { ...run, panes };
}

/**
 * Drop a tab onto the workspace region. `center` joins the first pane as a tab;
 * an edge splits the workspace into a second pane beside what's already open.
 * Caps at MAX_PANES — an edge drop while already split joins as a tab instead.
 *
 * Edge case: when `run` is null OR every existing pane is empty, treat the drop
 * as a `center` (join/create) regardless of `edge`. Never create a second empty
 * pane alongside an already-empty one.
 */
export function moveTabToRun(run: RunState | null, guest: RunTab, edge: RunDropEdge): RunState {
  const base = run ?? emptyRun();
  const hasExistingTabs = base.panes.some((p) => p.tabs.length > 0);
  const splitting = edge !== 'center' && base.panes.length < MAX_PANES && hasExistingTabs;
  // No paneId given — always succeeds (non-null). The assertion is safe:
  // addRunTab returns null only for an explicit missing paneId, never for the
  // first-pane default path used here.

  if (!splitting) return addRunTab(base, guest)!;

  const dir: 'v' | 'h' = edge === 'left' || edge === 'right' ? 'v' : 'h';
  const newPane: RunPane = { id: genId('pane'), tabs: [guest], active: guest.id };
  const [existing] = base.panes;
  const panes = edge === 'left' || edge === 'top' ? [newPane, existing!] : [existing!, newPane];
  return { dir, flex: [1, 1], panes };
}
