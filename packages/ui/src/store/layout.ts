import { releaseSubagentHistory } from '@/features/chat/messages/turn/subagent-history-store';
import { disclosureStore } from '@/features/chat/messages/turn/disclosure-store';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  addRunTab as addRunTabReducer,
  activateRunTab as activateRunTabReducer,
  closePane as closePaneReducer,
  closeRunTab as closeRunTabReducer,
  isConversationTab,
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
  isSurfaceLit,
  placeInLayout,
  removeSurface,
  type SurfaceId,
  type WorkspaceLayout,
} from './layout-placement';
import { useActiveBasesStore } from './active-bases-store';
import { filterRunByScope } from './run-scope-filter';

export type { SurfaceId, WorkspaceLayout } from './layout-placement';
export { isSurfaceFloor, isSurfaceLit } from './layout-placement';

/** A single session's remembered workspace (surface placement + workspace panes). */
export interface SessionWorkspace {
  layout: WorkspaceLayout;
  run: RunState | null;
}

// ── store ─────────────────────────────────────────────────────────────────

const INITIAL_LAYOUT: WorkspaceLayout = { top: ['chat'], topFlex: {} };

/**
 * True once nothing the user can see is left in the workspace. Tabs of another
 * launch scope stay in the panes unseen, so an empty `run` alone is too late:
 * the last VISIBLE tab is the one whose close collapses the panel (W5).
 */
function nothingVisible(run: RunState | null, closed: RunTab | undefined): boolean {
  const scope =
    closed == null || isConversationTab(closed) ? useActiveBasesStore.getState().scopeKey : (closed.scopeKey ?? null);
  return filterRunByScope(run, scope) == null;
}

export interface LayoutStore {
  layout: WorkspaceLayout;
  run: RunState | null;
  /** Per-session remembered workspaces. */
  sessions: Map<string, SessionWorkspace>;
  activeSessionId: string | null;

  /** Switch the active session, restoring (or seeding) its remembered workspace. */
  setActiveSession: (sessionId: string) => void;

  toggleSurface: (surface: SurfaceId) => void;
  /** Called by the SurfDivider; frac = the chat's fraction of the row's width. */
  setTopFrac: (frac: number) => void;
  /** Open (or focus) a file-backed tab in the workspace and light the surface; returns its id. */
  openFileTab: (target: OpenFileTarget, mode: TabMode, paneId?: string) => string;
  /** Promote a preview tab to permanent (double-click / first edit). */
  promoteFileTab: (tabId: string) => void;
  /** Append a tab (terminal/preview). False when an explicit `paneId` no longer exists (M6). */
  addRunTab: (tab: RunTab, paneId?: string) => boolean;
  /** Append a tab to a session's remembered workspace and light it, whether or not it is the active one. */
  addSessionTab: (sessionId: string, tab: RunTab) => void;
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

    return {
      layout: INITIAL_LAYOUT,
      run: null,
      sessions: new Map(),
      activeSessionId: null,

      setActiveSession(sessionId) {
        const { sessions } = get();
        const existing = sessions.get(sessionId);
        // structuredClone so per-session seeds don't share nested topFlex refs.
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
        const lit = isSurfaceLit(layout, surface);
        writeWorkspace({ layout: lit ? removeSurface(layout, surface) : placeInLayout(layout, surface), run });
      },

      setTopFrac(frac) {
        const { layout, run } = get();
        if (layout.top.length < 2) return;
        const [a, b] = layout.top as [SurfaceId, SurfaceId];
        const c = Math.max(0.18, Math.min(0.82, frac));
        writeWorkspace({ layout: { ...layout, topFlex: { ...layout.topFlex, [a]: c, [b]: 1 - c } }, run });
      },

      openFileTab(target, mode, paneId) {
        const { layout, run } = get();
        const next = openFileTabReducer(run, target, mode, paneId);
        writeWorkspace({ layout: placeInLayout(layout, 'workspace'), run: next.run });
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
        writeWorkspace({ layout: placeInLayout(layout, 'workspace'), run: nextRun });
        return true;
      },

      addSessionTab(sessionId, tab) {
        const { sessions, activeSessionId } = get();
        if (sessionId === activeSessionId) {
          get().addRunTab(tab);
          return;
        }
        const entry = sessions.get(sessionId) ?? { layout: structuredClone(INITIAL_LAYOUT), run: null };
        const run = addRunTabReducer(entry.run, tab);
        set({
          sessions: new Map(sessions).set(sessionId, { layout: placeInLayout(entry.layout, 'workspace'), run }),
        });
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
        if (tab?.kind === 'chat' && tab.chatId) {
          disclosureStore.clearAutomaticChat(tab.chatId);
          releaseSubagentHistory(tab.chatId);
        }
        // Preview destruction: PreviewInstance's own unmount cleanup, once removed.
        const nextRun = closeRunTabReducer(run, paneId, tabId);
        const collapse = nothingVisible(nextRun, tab);
        writeWorkspace({ layout: collapse ? removeSurface(layout, 'workspace') : layout, run: nextRun });
      },

      closePane(paneId) {
        const { layout, run } = get();
        if (!run) return;
        killAndDisposeCachedTerminals(tabIdsInPane(run, paneId, 'terminal'));
        releaseUrlTunnels(tabIdsInPane(run, paneId, 'url'));
        // Preview destruction: PreviewInstance's own unmount cleanup, once removed.
        const closed = run.panes.find((p) => p.id === paneId)?.tabs[0];
        const nextRun = closePaneReducer(run, paneId);
        const collapse = nothingVisible(nextRun, closed);
        writeWorkspace({ layout: collapse ? removeSurface(layout, 'workspace') : layout, run: nextRun });
      },

      releaseRunScope(scopeKey) {
        const { layout, run } = get();
        if (!run) return;
        killAndDisposeCachedTerminals(tabIdsForScope(run, scopeKey, 'terminal'));
        releaseUrlTunnels(tabIdsForScope(run, scopeKey, 'url'));
        // Preview/console bodies tear down via their own unmount cleanup once removed.
        const nextRun = releaseRunScopeReducer(run, scopeKey);
        // As closing its tabs one by one would (W5).
        const collapse = nextRun == null || (!nothingVisible(run, undefined) && nothingVisible(nextRun, undefined));
        writeWorkspace({ layout: !collapse ? layout : removeSurface(layout, 'workspace'), run: nextRun });
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
