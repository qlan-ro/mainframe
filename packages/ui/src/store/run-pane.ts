/**
 * store/run-pane.ts — Run surface multi-pane model (Phase 8).
 *
 * Mirrors the Run engine in prototype/04-engine.jsx: a Run surface holds 1–2
 * panes laid out along an axis (`dir`), each pane a tab strip. A Files tab
 * dragged onto Run becomes a GUEST (center = join the existing pane as a tab,
 * edge = split into a second pane). All functions here are PURE — the store
 * (`layout.ts`) owns the wiring + side-effects.
 */

export type RunTabKind = 'preview' | 'console' | 'terminal' | 'code' | 'diff' | 'skill' | 'viewer';

/** A tab inside a Run pane (a launched preview/console, a terminal, or a Files guest). */
export interface RunTab {
  id: string;
  kind: RunTabKind;
  title: string;
  /** File path for code/diff/skill/viewer guests; absent for preview/console/terminal. */
  path?: string;
  /** Launch-config name for preview (webview) and console (process) tabs. */
  config?: string;
  /** Resolved dev-server port for a preview tab (the webview loads localhost:port). */
  port?: number;
  /**
   * Launch scope this tab belongs to (`buildLaunchScope(projectId,
   * effectivePath)`), captured at creation from the active session. Run tabs are
   * global (not bound to the active chat), so each carries its own scope: launch
   * tabs filter their console/status by it, and the Run surface shows only the
   * tabs matching the active session's scope (so they don't leak across
   * projects/worktrees). Stamped on EVERY tab — launch configs, terminals, and
   * Files guests — from the active session; only absent on a draft/unresolved
   * session (no scope yet).
   */
  scopeKey?: string;
}

/** A launch-config tab — a `preview` webview or a `console` process. */
function isLaunchTab(t: RunTab): boolean {
  return t.kind === 'preview' || t.kind === 'console';
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

/** Where a dragged tab lands on the Run region. */
export type RunDropEdge = 'center' | 'left' | 'right' | 'top' | 'bottom';

const MAX_PANES = 2;

function genId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}

/** A Run surface with one empty pane. */
export function emptyRun(): RunState {
  return { dir: 'v', flex: [1, 1], panes: [{ id: genId('pane'), tabs: [], active: null }] };
}

/**
 * Append a tab to a pane and focus it. With no `paneId`, targets the first pane
 * (back-compat) and creates the Run state if absent. Returns a new `RunState` on
 * success. Returns `null` to signal an explicit no-op — the given `paneId` no
 * longer exists — so the caller disposes the orphan terminal; never silently
 * falls back to pane 0 (M6). `null` is the unambiguous no-op signal: it does not
 * rely on reference equality, which a fresh `emptyRun()` would defeat when `run`
 * was `null` and the target pane was missing.
 */
export function addRunTab(run: RunState | null, tab: RunTab, paneId?: string): RunState | null {
  const base = run ?? emptyRun();
  // Launch-config tabs (preview webview OR console process) are singletons per
  // config WITHIN a launch scope: if one already exists for the same config AND
  // scope (in any pane), focus it instead of stacking a duplicate — the run
  // button re-launches the same config repeatedly. Different scopes (a same-named
  // config in another project/worktree) get their own tab. This is the "or
  // activates" half of addRunTab.
  if (isLaunchTab(tab) && tab.config) {
    const matches = (t: RunTab): boolean => isLaunchTab(t) && t.config === tab.config && t.scopeKey === tab.scopeKey;
    const pane = base.panes.find((p) => p.tabs.some(matches));
    if (pane) {
      const existing = pane.tabs.find(matches)!;
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
 * whole Run surface is now empty (caller closes the Run surface).
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

/** Every terminal tab id in the run state (across all panes). */
export function terminalIdsInRun(run: RunState | null): string[] {
  if (!run) return [];
  return run.panes.flatMap((p) => p.tabs.filter((t) => t.kind === 'terminal').map((t) => t.id));
}

/** Terminal tab ids in a single pane. */
export function terminalIdsInPane(run: RunState | null, paneId: string): string[] {
  if (!run) return [];
  const pane = run.panes.find((p) => p.id === paneId);
  if (!pane) return [];
  return pane.tabs.filter((t) => t.kind === 'terminal').map((t) => t.id);
}

/**
 * Drop a guest tab onto the Run region. `center` joins the first pane as a tab;
 * an edge splits Run into a second pane with the guest beside what's running.
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
