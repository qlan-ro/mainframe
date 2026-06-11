/**
 * store/run-pane.ts — Run surface multi-pane model (Phase 8).
 *
 * Mirrors the Run engine in prototype/04-engine.jsx: a Run surface holds 1–2
 * panes laid out along an axis (`dir`), each pane a tab strip. A Files tab
 * dragged onto Run becomes a GUEST (center = join the existing pane as a tab,
 * edge = split into a second pane). All functions here are PURE — the store
 * (`layout.ts`) owns the wiring + side-effects.
 */

export type RunTabKind = 'preview' | 'terminal' | 'code' | 'diff' | 'skill' | 'viewer';

/** A tab inside a Run pane (a launched preview, a terminal, or a Files guest). */
export interface RunTab {
  id: string;
  kind: RunTabKind;
  title: string;
  /** File path for code/diff/skill/viewer guests; absent for preview/terminal. */
  path?: string;
  /** Launch-config name for preview tabs. */
  config?: string;
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

/** Append a tab to the first pane and focus it. Creates the Run state if absent. */
export function addRunTab(run: RunState | null, tab: RunTab): RunState {
  const base = run ?? emptyRun();
  const [first, ...rest] = base.panes;
  if (!first) return base;
  const nextFirst: RunPane = { ...first, tabs: [...first.tabs, tab], active: tab.id };
  return { ...base, panes: [nextFirst, ...rest] };
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

/**
 * Drop a guest tab onto the Run region. `center` joins the first pane as a tab;
 * an edge splits Run into a second pane with the guest beside what's running.
 * Caps at MAX_PANES — an edge drop while already split joins as a tab instead.
 */
export function moveTabToRun(run: RunState | null, guest: RunTab, edge: RunDropEdge): RunState {
  const base = run ?? emptyRun();
  const splitting = edge !== 'center' && base.panes.length < MAX_PANES;
  if (!splitting) return addRunTab(base, guest);

  const dir: 'v' | 'h' = edge === 'left' || edge === 'right' ? 'v' : 'h';
  const newPane: RunPane = { id: genId('pane'), tabs: [guest], active: guest.id };
  const [existing] = base.panes;
  const panes = edge === 'left' || edge === 'top' ? [newPane, existing!] : [existing!, newPane];
  return { dir, flex: [1, 1], panes };
}
