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
  type RunState,
  type RunTab,
  type TabMode,
} from './run-pane';
import {
  openFileTab as openFileTabReducer,
  promoteFileTab as promoteFileTabReducer,
  type OpenFileTarget,
} from './run-pane-file-tabs';
import { killAndDisposeCachedTerminals } from './terminal-cleanup';
import { releaseUrlTunnels } from './url-tunnel-cleanup';
import { layoutPersistOptions, prunePersistedSessions } from './layout-persist';
import { adoptSessionEntry, dropSessionEntry } from './layout-sessions';
import {
  isSurfaceFloor,
  layoutCanSplit,
  placeInLayout,
  removeSurface,
  repositionInLayout,
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

/** Injected by features/chat/zones (store/ cannot import features/): true while the
 *  chat split is on screen, so a surface lit mid-split lands in the bottom strip. */
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

  /** Set while the chat split parked the workspace in the strip — holds the top-row
   *  side it came from so the restore returns it there. Transient by design. */
  workspaceSystemMoved: 'top-left' | 'top-right' | null;
  /** Chat-split follower (split plan, decision 8): a top-row workspace moves to
   *  the bottom strip when the chat splits… */
  moveWorkspaceForChatSplit: () => void;
  /** …and returns beside the chat on unsplit. */
  restoreWorkspaceAfterChatSplit: () => void;
  /** Open (or focus) a file-backed tab in the workspace and light the surface; returns its id. */
  openFileTab: (target: OpenFileTarget, mode: TabMode, paneId?: string) => string;
  /** Promote a preview tab to permanent (double-click / first edit). */
  promoteFileTab: (tabId: string) => void;
  /** Append a tab (terminal/preview). False when an explicit `paneId` no longer exists (M6). */
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
  /** Drop a session's workspace (kill-before-remove); re-seeds chat-only if it was active. */
  dropSession: (sessionId: string) => void;
  /** Move a session's workspace onto a new key (draft → real chat handoff); never disposes. */
  adoptSession: (fromId: string, toId: string) => void;
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

    /** placeInLayout, but split-aware: while the chat split is visible a newly lit
     *  workspace goes to the bottom strip, claimed as system-moved to return later. */
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

      // Hiding PRESERVES panes and kills nothing (detach, not dispose);
      // kill-before-remove stays on closeRunTab / closePane / releaseRunScope.
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
        // null = explicit paneId gone; false tells the subscriber to dispose the orphan.
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
        // Preview destruction: PreviewInstance's own unmount cleanup, once removed.
        const nextRun = closeRunTabReducer(run, paneId, tabId);
        writeWorkspace({ layout: nextRun ? layout : removeSurface(layout, 'workspace'), run: nextRun });
      },

      closePane(paneId) {
        const { layout, run } = get();
        if (!run) return;
        killAndDisposeCachedTerminals(tabIdsInPane(run, paneId, 'terminal'));
        releaseUrlTunnels(tabIdsInPane(run, paneId, 'url'));
        // Preview destruction: PreviewInstance's own unmount cleanup, once removed.
        const nextRun = closePaneReducer(run, paneId);
        writeWorkspace({ layout: nextRun ? layout : removeSurface(layout, 'workspace'), run: nextRun });
      },

      releaseRunScope(scopeKey) {
        const { layout, run } = get();
        if (!run) return;
        killAndDisposeCachedTerminals(tabIdsForScope(run, scopeKey, 'terminal'));
        releaseUrlTunnels(tabIdsForScope(run, scopeKey, 'url'));
        // Preview/console bodies tear down via their own unmount cleanup once removed.
        const nextRun = releaseRunScopeReducer(run, scopeKey);
        writeWorkspace({ layout: nextRun ? layout : removeSurface(layout, 'workspace'), run: nextRun });
      },

      pruneSessions(validIds) {
        const { sessions, activeSessionId } = get();
        const next = prunePersistedSessions(sessions, validIds, activeSessionId);
        if (next !== sessions) set({ sessions: next });
      },

      dropSession(sessionId) {
        const { sessions, activeSessionId } = get();
        const nextSessions = dropSessionEntry(sessions, sessionId);
        if (activeSessionId === sessionId) {
          set({ sessions: nextSessions, layout: structuredClone(INITIAL_LAYOUT), run: null });
        } else if (nextSessions !== sessions) {
          set({ sessions: nextSessions });
        }
      },

      adoptSession(fromId, toId) {
        const { sessions, activeSessionId } = get();
        const nextSessions = adoptSessionEntry(sessions, fromId, toId);
        if (nextSessions === sessions) return;
        set({ sessions: nextSessions, activeSessionId: activeSessionId === fromId ? toId : activeSessionId });
      },
    };
  }, layoutPersistOptions),
);
