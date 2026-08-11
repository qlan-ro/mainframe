import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  addRunTab as addRunTabReducer,
  activateRunTab as activateRunTabReducer,
  closePane as closePaneReducer,
  closeRunTab as closeRunTabReducer,
  releaseRunScope as releaseRunScopeReducer,
  retargetUrlTab as retargetUrlTabReducer,
  tabIdsForScope,
  tabIdsInPane,
  type RunDropEdge,
  type RunState,
  type RunTab,
  type TabMode,
} from './run-pane';
import {
  moveTabToPaneEdge as moveTabToPaneEdgeReducer,
  openFileTab as openFileTabReducer,
  promoteFileTab as promoteFileTabReducer,
  type OpenFileTarget,
} from './run-pane-file-tabs';
import { killAndDisposeCachedTerminals } from './terminal-cleanup';
import { releaseUrlTunnels } from './url-tunnel-cleanup';
import { layoutPersistOptions, prunePersistedSessions } from './layout-persist';
import {
  isSurfaceFloor,
  layoutCanSplit,
  placeInLayout,
  removeSurface,
  repositionInLayout,
  type RepositionTarget,
  type SurfaceId,
  type WorkspaceLayout,
} from './layout-placement';

export type { RepositionTarget, SurfaceId, WorkspaceLayout } from './layout-placement';
export { isSurfaceFloor, layoutCanSplit, litSurfaceCount } from './layout-placement';

/** A single session's remembered workspace (surface placement + workspace panes). */
export interface SessionWorkspace {
  layout: WorkspaceLayout;
  run: RunState | null;
}

// ── store ─────────────────────────────────────────────────────────────────

/** Injected by features/chat/zones (store/ cannot import features/): true
 *  while the chat split is on screen. Workspace placement consults it so a
 *  surface lit mid-split lands in the bottom strip instead of taking half the
 *  top row and starving the split below its width floor. */
let chatSplitVisibleProbe: () => boolean = () => false;
export function registerChatSplitVisibleProbe(probe: () => boolean): void {
  chatSplitVisibleProbe = probe;
}

const INITIAL_LAYOUT: WorkspaceLayout = {
  top: ['chat'],
  bottom: null,
  topFlex: {},
  vFlex: { top: 1, bottom: 0.4 },
};

export interface LayoutStore {
  layout: WorkspaceLayout;
  run: RunState | null;
  /** Per-session remembered workspaces. */
  sessions: Map<string, SessionWorkspace>;
  activeSessionId: string | null;

  /** Switch the active session, restoring (or seeding) its remembered workspace. */
  setActiveSession: (sessionId: string) => void;

  toggleSurface: (surface: SurfaceId) => void;
  /** Called by the horizontal SurfDivider; frac = fraction of the top-row width. */
  setTopFrac: (frac: number) => void;
  /** Called by the vertical SurfDivider; frac = fraction of the total height. */
  setVFrac: (frac: number) => void;
  /** Place the workspace surface side-by-side ('v') or in the bottom strip ('h'). */
  splitSurface: (orientation: 'v' | 'h') => void;

  /** Drag-reposition a whole surface within the layout. */
  repositionSurface: (surface: SurfaceId, target: RepositionTarget) => void;
  /** Set while the chat split (not the user) parked the workspace in the strip —
   *  holds the top-row side it came from so the restore returns it there.
   *  Transient by design: after a reload the restore simply doesn't fire, which
   *  errs toward never overriding an arrangement. */
  workspaceSystemMoved: 'top-left' | 'top-right' | null;
  /** Chat-split follower (split plan, decision 8): a top-row workspace moves to
   *  the bottom strip when the chat splits… */
  moveWorkspaceForChatSplit: () => void;
  /** …and returns beside the chat on unsplit — unless the user repositioned
   *  anything in between (repositionSurface clears the flag). */
  restoreWorkspaceAfterChatSplit: () => void;
  /** Drag an open workspace tab to a pane edge (center = join pane 1, edge = split). */
  moveTabToPaneEdge: (tabId: string, edge: RunDropEdge) => void;
  /**
   * Open (or focus) a file-backed tab in the workspace and light the surface.
   * Returns the id of the tab now focused.
   */
  openFileTab: (target: OpenFileTarget, mode: TabMode, paneId?: string) => string;
  /** Promote a preview tab to permanent (double-click / first edit). */
  promoteFileTab: (tabId: string) => void;
  /**
   * Append a tab to the workspace (terminal/preview launches). Returns true when the tab
   * was added, false when an explicit `paneId` was given but that pane no longer
   * exists (M6 — the caller must dispose the orphaned terminal).
   */
  addRunTab: (tab: RunTab, paneId?: string) => boolean;
  activateRunTab: (paneId: string, tabId: string) => void;
  /** Point a URL tab at a newly committed URL. The tab's id — and its webview — survive. */
  setUrlTabTarget: (tabId: string, url: string, title: string) => void;
  closeRunTab: (paneId: string, tabId: string) => void;
  closePane: (paneId: string) => void;
  /** Release a launch scope: dispose its terminals and drop its workspace tabs. */
  releaseRunScope: (scopeKey: string) => void;
  /** GC: remove persisted entries for sessions no longer in the thread list. */
  pruneSessions: (validIds: Set<string>) => void;
}

export const useLayoutStore = create<LayoutStore>()(
  persist((set, get) => {
    /** Write the active workspace to top-level state + persist it per-session. */
    function writeWorkspace(next: SessionWorkspace): void {
      const { activeSessionId, sessions } = get();
      if (!activeSessionId) {
        set({ layout: next.layout, run: next.run });
        return;
      }
      const nextSessions = new Map(sessions);
      nextSessions.set(activeSessionId, next);
      set({ layout: next.layout, run: next.run, sessions: nextSessions });
    }

    /** placeInLayout for the workspace, but split-aware: while the chat split
     *  is visible a newly lit workspace goes UNDER it (bottom strip), claimed
     *  as system-moved so unsplitting brings it up beside the chat. */
    function placeWorkspace(layout: WorkspaceLayout): WorkspaceLayout {
      if (chatSplitVisibleProbe() && layout.bottom == null && !layout.top.includes('workspace')) {
        set({ workspaceSystemMoved: 'top-right' });
        return { ...layout, bottom: 'workspace' };
      }
      return placeInLayout(layout, 'workspace');
    }

    return {
      layout: INITIAL_LAYOUT,
      run: null,
      sessions: new Map(),
      activeSessionId: null,

      setActiveSession(sessionId) {
        const { sessions } = get();
        const existing = sessions.get(sessionId);
        // structuredClone so per-session seeds don't share nested topFlex/vFlex refs.
        const ws: SessionWorkspace = existing ?? { layout: structuredClone(INITIAL_LAYOUT), run: null };
        const nextSessions = existing ? sessions : new Map(sessions).set(sessionId, ws);
        set({ activeSessionId: sessionId, layout: ws.layout, run: ws.run, sessions: nextSessions });
      },

      // Hiding the workspace PRESERVES its panes and kills nothing: the surface
      // now holds the user's open files, and the terminal cache detaches without
      // disposing, so re-showing reattaches live output. Kill-before-remove
      // stays on the real close paths (closeRunTab / closePane / releaseRunScope).
      toggleSurface(surface) {
        const { layout, run } = get();
        // Dynamic floor: the last lit surface (chat or workspace) can't be hidden.
        if (isSurfaceFloor(layout, surface)) return;
        const isActive = layout.top.includes(surface) || layout.bottom === surface;
        writeWorkspace({
          layout: isActive
            ? removeSurface(layout, surface)
            : surface === 'workspace'
              ? placeWorkspace(layout)
              : placeInLayout(layout, surface),
          run,
        });
      },

      setTopFrac(frac) {
        const { layout, run } = get();
        if (layout.top.length < 2) return;
        const [a, b] = layout.top as [SurfaceId, SurfaceId];
        const c = Math.max(0.18, Math.min(0.82, frac));
        writeWorkspace({ layout: { ...layout, topFlex: { ...layout.topFlex, [a]: c, [b]: 1 - c } }, run });
      },

      setVFrac(frac) {
        const { layout, run } = get();
        const c = Math.max(0.18, Math.min(0.82, frac));
        writeWorkspace({ layout: { ...layout, vFlex: { top: c, bottom: 1 - c } }, run });
      },

      splitSurface(orientation) {
        const { layout, run } = get();
        if (!layoutCanSplit(layout)) return;
        if (orientation === 'v') {
          writeWorkspace({ layout: placeWorkspace(layout), run });
        } else {
          if (layout.bottom) return;
          writeWorkspace({ layout: { ...layout, bottom: 'workspace' }, run });
        }
      },

      repositionSurface(surface, target) {
        const { layout, run } = get();
        // A manual reposition takes ownership — the split must not undo it.
        set({ workspaceSystemMoved: null });
        writeWorkspace({ layout: repositionInLayout(layout, surface, target), run });
      },

      workspaceSystemMoved: null,

      moveWorkspaceForChatSplit() {
        const { layout, run } = get();
        if (!layout.top.includes('workspace')) return;
        set({ workspaceSystemMoved: layout.top[0] === 'workspace' ? 'top-left' : 'top-right' });
        writeWorkspace({ layout: repositionInLayout(layout, 'workspace', 'bottom'), run });
      },

      restoreWorkspaceAfterChatSplit() {
        const { layout, run, workspaceSystemMoved } = get();
        set({ workspaceSystemMoved: null });
        if (workspaceSystemMoved == null || layout.bottom !== 'workspace') return;
        writeWorkspace({ layout: repositionInLayout(layout, 'workspace', workspaceSystemMoved), run });
      },

      moveTabToPaneEdge(tabId, edge) {
        const { layout, run } = get();
        if (!run) return;
        const nextRun = moveTabToPaneEdgeReducer(run, tabId, edge);
        if (nextRun !== run) writeWorkspace({ layout, run: nextRun });
      },

      openFileTab(target, mode, paneId) {
        const { layout, run } = get();
        const next = openFileTabReducer(run, target, mode, paneId);
        writeWorkspace({ layout: placeWorkspace(layout), run: next.run });
        return next.tabId;
      },

      promoteFileTab(tabId) {
        const { layout, run } = get();
        if (!run) return;
        const nextRun = promoteFileTabReducer(run, tabId);
        if (nextRun !== run) writeWorkspace({ layout, run: nextRun });
      },

      addRunTab(tab, paneId) {
        const { layout, run } = get();
        const nextRun = addRunTabReducer(run, tab, paneId);
        // The reducer returns null to signal a no-op (explicit paneId gone). Report
        // false so the subscriber disposes the orphaned terminal (Task 10). On
        // success it returns a real RunState; commit it and light the workspace.
        if (nextRun === null) return false;
        writeWorkspace({ layout: placeWorkspace(layout), run: nextRun });
        return true;
      },

      activateRunTab(paneId, tabId) {
        const { layout, run } = get();
        if (!run) return;
        writeWorkspace({ layout, run: activateRunTabReducer(run, paneId, tabId) });
      },

      setUrlTabTarget(tabId, url, title) {
        const { layout, run } = get();
        if (!run) return;
        const nextRun = retargetUrlTabReducer(run, tabId, url, title);
        if (nextRun !== run) writeWorkspace({ layout, run: nextRun });
      },

      closeRunTab(paneId, tabId) {
        const { layout, run } = get();
        if (!run) return;
        const tab = run.panes.find((p) => p.id === paneId)?.tabs.find((t) => t.id === tabId);
        if (tab?.kind === 'terminal') killAndDisposeCachedTerminals([tabId]);
        if (tab?.kind === 'url') releaseUrlTunnels([tabId]);
        // Preview destruction is handled by the PreviewInstance lifecycle hook's
        // cleanup effect when the component unmounts after the tab is removed.
        const nextRun = closeRunTabReducer(run, paneId, tabId);
        writeWorkspace({ layout: nextRun ? layout : removeSurface(layout, 'workspace'), run: nextRun });
      },

      closePane(paneId) {
        const { layout, run } = get();
        if (!run) return;
        killAndDisposeCachedTerminals(tabIdsInPane(run, paneId, 'terminal'));
        releaseUrlTunnels(tabIdsInPane(run, paneId, 'url'));
        // Preview destruction is handled by the PreviewInstance lifecycle hook's
        // cleanup effect when components unmount after the pane is removed.
        const nextRun = closePaneReducer(run, paneId);
        writeWorkspace({ layout: nextRun ? layout : removeSurface(layout, 'workspace'), run: nextRun });
      },

      releaseRunScope(scopeKey) {
        const { layout, run } = get();
        if (!run) return;
        killAndDisposeCachedTerminals(tabIdsForScope(run, scopeKey, 'terminal'));
        releaseUrlTunnels(tabIdsForScope(run, scopeKey, 'url'));
        // Preview/console bodies tear down via their unmount cleanup once the
        // tabs are removed (PreviewInstance destroys its webview).
        const nextRun = releaseRunScopeReducer(run, scopeKey);
        writeWorkspace({ layout: nextRun ? layout : removeSurface(layout, 'workspace'), run: nextRun });
      },

      pruneSessions(validIds) {
        const { sessions } = get();
        const next = prunePersistedSessions(sessions, validIds);
        if (next !== sessions) set({ sessions: next });
      },
    };
  }, layoutPersistOptions),
);
