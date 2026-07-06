/**
 * store/run-scope-filter.ts — scope-filter the global Run state for display.
 *
 * Run tabs are GLOBAL (a single `layout.run`) and every tab carries its own
 * `scopeKey` (`buildLaunchScope(projectId, effectivePath)`) — captured at
 * creation from the active session (launch configs, terminals, and Files
 * guests alike). The Run surface must show only the tabs belonging to the
 * ACTIVE session's launch scope — otherwise a tab opened under project/worktree
 * A keeps rendering after the user switches to a session under project/worktree
 * B (the tab "leak").
 *
 * Pure view-derivation: the global store is untouched; this only shapes what
 * RunSurface renders for the current scope.
 */
import type { RunPane, RunState } from './run-pane';

/**
 * Keep only the tabs whose scope matches `activeScopeKey`. A tab with no
 * `scopeKey` matches only a null active scope (an unresolved/draft session).
 * Panes left empty are dropped; a pane whose active tab was dropped re-points
 * to its first survivor. Returns `null` when nothing remains (RunSurface then
 * shows the empty picker).
 */
export function filterRunByScope(run: RunState | null, activeScopeKey: string | null): RunState | null {
  if (!run) return null;

  const panes: RunPane[] = [];
  for (const pane of run.panes) {
    const tabs = pane.tabs.filter((t) => (t.scopeKey ?? null) === activeScopeKey);
    if (tabs.length === 0) continue;
    const active = tabs.some((t) => t.id === pane.active) ? pane.active : tabs[0]!.id;
    panes.push({ ...pane, tabs, active });
  }

  if (panes.length === 0) return null;
  // Mirror closeRunTab: collapsing to a single pane resets its flex weights.
  return { ...run, panes, flex: panes.length === 1 ? [1, 1] : run.flex };
}
