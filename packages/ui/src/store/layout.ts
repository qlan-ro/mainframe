import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  addRunTab as addRunTabReducer,
  activateRunTab as activateRunTabReducer,
  closePane as closePaneReducer,
  closeRunTab as closeRunTabReducer,
  moveTabToRun as moveTabToRunReducer,
  releaseRunScope as releaseRunScopeReducer,
  retargetUrlTab as retargetUrlTabReducer,
  tabIdsForScope,
  tabIdsInPane,
  tabIdsInRun,
  type RunDropEdge,
  type RunState,
  type RunTab,
} from './run-pane';
import { useTabsStore } from './tabs';
import { useActiveBasesStore } from './active-bases-store';
import { killAndDisposeCachedTerminals } from './terminal-cleanup';
import { releaseUrlTunnels } from './url-tunnel-cleanup';
import { layoutPersistOptions, prunePersistedSessions } from './layout-persist';
import {
  isSurfaceFloor,
  placeInLayout,
  removeSurface,
  repositionInLayout,
  type RepositionTarget,
  type SurfaceId,
  type WorkspaceLayout,
} from './layout-placement';

export type { RepositionTarget, SurfaceId, WorkspaceLayout } from './layout-placement';
export { isSurfaceFloor, layoutCanSplit, litSurfaceCount } from './layout-placement';

/** A single session's remembered workspace (surface placement + Run panes). */
export interface SessionWorkspace {
  layout: WorkspaceLayout;
  run: RunState | null;
}

/** Build a RunTab guest from a Files editor tab, stamped with the active scope. */
function guestFromFilesTab(tabId: string): RunTab | null {
  const tab = useTabsStore.getState().tabs.find((t) => t.id === tabId);
  if (!tab) return null;
  const scopeKey = useActiveBasesStore.getState().scopeKey ?? undefined;
  return { id: `run-${tab.id}`, kind: tab.kind, title: tab.title, path: tab.path, scopeKey };
}

// ── store ─────────────────────────────────────────────────────────────────

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
  /** Add the next missing surface side-by-side ('v') or to the bottom strip ('h'). */
  splitSurface: (orientation: 'v' | 'h') => void;

  /** Drag-reposition a whole surface within the layout. */
  repositionSurface: (surface: SurfaceId, target: RepositionTarget) => void;
  /** Drag a Files tab onto Run (center = join, edge = split). */
  moveFilesTabToRun: (tabId: string, edge: RunDropEdge) => void;
  /**
   * Append a tab to Run (terminal/preview launches). Returns true when the tab
   * was added, false when an explicit `paneId` was given but that pane no longer
   * exists (M6 — the caller must dispose the orphaned terminal).
   */
  addRunTab: (tab: RunTab, paneId?: string) => boolean;
  activateRunTab: (paneId: string, tabId: string) => void;
  /** Point a URL tab at a newly committed URL. The tab's id — and its webview — survive. */
  setUrlTabTarget: (tabId: string, url: string, title: string) => void;
  closeRunTab: (paneId: string, tabId: string) => void;
  closePane: (paneId: string) => void;
  /** Release a launch scope: dispose its terminals and drop its Run tabs. */
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

      toggleSurface(surface) {
        const { layout, run } = get();
        // Dynamic floor: the last lit surface (any of chat/files/run) can't be hidden.
        if (isSurfaceFloor(layout, surface)) return;
        const isActive = layout.top.includes(surface) || layout.bottom === surface;
        const nextLayout = isActive ? removeSurface(layout, surface) : placeInLayout(layout, surface);
        // Toggling Run off kills any live PTYs and releases URL tabs' tunnels before discarding the panes.
        if (surface === 'run' && isActive) {
          killAndDisposeCachedTerminals(tabIdsInRun(run, 'terminal'));
          releaseUrlTunnels(tabIdsInRun(run, 'url'));
        }
        writeWorkspace({ layout: nextLayout, run: surface === 'run' && isActive ? null : run });
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
        const next = (['files', 'run'] as SurfaceId[]).find((s) => !layout.top.includes(s) && layout.bottom !== s);
        if (!next) return;
        if (orientation === 'v') {
          writeWorkspace({ layout: placeInLayout(layout, next), run });
        } else {
          if (layout.bottom) return;
          writeWorkspace({ layout: { ...layout, bottom: next }, run });
        }
      },

      repositionSurface(surface, target) {
        const { layout, run } = get();
        writeWorkspace({ layout: repositionInLayout(layout, surface, target), run });
      },

      moveFilesTabToRun(tabId, edge) {
        const guest = guestFromFilesTab(tabId);
        if (!guest) return;
        const { layout, run } = get();
        const nextRun = moveTabToRunReducer(run, guest, edge);
        // Remove the tab from Files and ensure Run is placed in the layout.
        useTabsStore.getState().closeTab(tabId);
        writeWorkspace({ layout: placeInLayout(layout, 'run'), run: nextRun });
      },

      addRunTab(tab, paneId) {
        const { layout, run } = get();
        const nextRun = addRunTabReducer(run, tab, paneId);
        // The reducer returns null to signal a no-op (explicit paneId gone). Report
        // false so the subscriber disposes the orphaned terminal (Task 10). On
        // success it returns a real RunState; commit it and place Run in the layout.
        if (nextRun === null) return false;
        writeWorkspace({ layout: placeInLayout(layout, 'run'), run: nextRun });
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
        writeWorkspace({ layout: nextRun ? layout : removeSurface(layout, 'run'), run: nextRun });
      },

      closePane(paneId) {
        const { layout, run } = get();
        if (!run) return;
        killAndDisposeCachedTerminals(tabIdsInPane(run, paneId, 'terminal'));
        releaseUrlTunnels(tabIdsInPane(run, paneId, 'url'));
        // Preview destruction is handled by the PreviewInstance lifecycle hook's
        // cleanup effect when components unmount after the pane is removed.
        const nextRun = closePaneReducer(run, paneId);
        writeWorkspace({ layout: nextRun ? layout : removeSurface(layout, 'run'), run: nextRun });
      },

      releaseRunScope(scopeKey) {
        const { layout, run } = get();
        if (!run) return;
        killAndDisposeCachedTerminals(tabIdsForScope(run, scopeKey, 'terminal'));
        releaseUrlTunnels(tabIdsForScope(run, scopeKey, 'url'));
        // Preview/console bodies tear down via their unmount cleanup once the
        // tabs are removed (PreviewInstance destroys its webview).
        const nextRun = releaseRunScopeReducer(run, scopeKey);
        writeWorkspace({ layout: nextRun ? layout : removeSurface(layout, 'run'), run: nextRun });
      },

      pruneSessions(validIds) {
        const { sessions } = get();
        const next = prunePersistedSessions(sessions, validIds);
        if (next !== sessions) set({ sessions: next });
      },
    };
  }, layoutPersistOptions),
);
