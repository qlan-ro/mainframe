/**
 * ui-prefs — the single persisted store for global UI chrome.
 *
 * Owns sidebar visibility, the workspace Files sidebar's collapse, the
 * committed sidebar width, and the session panel's per-section open state. Persisted to localStorage under
 * `mf:ui-prefs` via zustand's persist middleware (mirrors store/tutorial.ts).
 * Per-session surface layout is NOT here — it stays in-memory in
 * store/layout.ts (live PTY/preview refs make it unsafe to persist).
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { clampSidebarWidth } from '@v2/components/ui/sidebar';

/** Matches the v2 sidebar's `SIDEBAR_WIDTH` (16rem) — the un-dragged default. */
const SIDEBAR_DEFAULT_WIDTH = 256;

/** The collapsible sidebar sections. Only Projects survived the v2 shell —
 *  Sessions/Tasks scroll as one region and Tags lives in the footer now. */
export type SidebarSection = 'projects';

/** The session panel's sections, in render order. Declared here rather than in
 *  `features/session-panel/` because this store persists their open-state and
 *  `store/` must not import from `features/`. */
export type SessionPanelSectionId = 'summary' | 'plan' | 'activity' | 'launch' | 'context';

/** Summary is never collapsible, so it has no open-state to persist. */
export type SessionPanelOpenSectionId = Exclude<SessionPanelSectionId, 'summary'>;

/** Open on first run: the panel stays dense, and Context is the reference material you scan. */
const SESSION_PANEL_SECTION_DEFAULTS: Record<SessionPanelOpenSectionId, boolean> = {
  plan: false,
  activity: false,
  launch: false,
  context: true,
};

export type SessionPanelSections = Partial<Record<SessionPanelOpenSectionId, boolean>>;

/** Selector helper: a section with no recorded state falls back to its default. */
export function isSessionPanelSectionOpen(sections: SessionPanelSections, id: SessionPanelOpenSectionId): boolean {
  return sections[id] ?? SESSION_PANEL_SECTION_DEFAULTS[id];
}

interface UiPrefsState {
  sidebarVisible: boolean;
  /** The workspace surface's local Files sidebar: false = expanded tree, true = thin rail. */
  workspaceFilesCollapsed: boolean;
  sidebarWidth: number;
  /** Once true, the one-time "Right-click for options" pill hint is suppressed for good. */
  rightClickHintDismissed: boolean;
  /** Once true, the mid-session model/effort/feature change warning is suppressed for good. */
  dontWarnOnTuningChange: boolean;
  /** Per-section collapse state for the left sidebar's four root sections.
   *  Absent keys read as expanded (false) — see isSidebarSectionCollapsed. */
  collapsedSidebarSections: Partial<Record<SidebarSection, boolean>>;
  /** Per-section open state for the right session panel. This store is the sole
   *  owner — the panel keeps no set of its own. Absent keys read as the
   *  section's default; see isSessionPanelSectionOpen. */
  sessionPanelSections: SessionPanelSections;
  /** The right session panel's own collapse. Only reachable on a surface wide
   *  enough to hold the panel — a narrow one collapses it regardless. */
  sessionPanelCollapsed: boolean;
  toggleSidebar: () => void;
  setSidebarVisible: (visible: boolean) => void;
  setWorkspaceFilesCollapsed: (collapsed: boolean) => void;
  setSidebarWidth: (width: number) => void;
  dismissRightClickHint: () => void;
  dismissTuningChangeWarning: () => void;
  toggleSidebarSection: (section: SidebarSection) => void;
  toggleSessionPanelSection: (id: SessionPanelOpenSectionId) => void;
  /** Idempotent open — a rail click that navigates to an already-open section
   *  must scroll to it, never collapse it. */
  expandSessionPanelSection: (id: SessionPanelOpenSectionId) => void;
  setSessionPanelCollapsed: (collapsed: boolean) => void;
}

/** Selector helper: a section with no recorded state is expanded by default. */
export function isSidebarSectionCollapsed(
  collapsed: Partial<Record<SidebarSection, boolean>>,
  section: SidebarSection,
): boolean {
  return collapsed[section] ?? false;
}

/** The persisted subset. */
function partializeUiPrefs(s: UiPrefsState) {
  return {
    sidebarVisible: s.sidebarVisible,
    workspaceFilesCollapsed: s.workspaceFilesCollapsed,
    sidebarWidth: s.sidebarWidth,
    rightClickHintDismissed: s.rightClickHintDismissed,
    dontWarnOnTuningChange: s.dontWarnOnTuningChange,
    collapsedSidebarSections: s.collapsedSidebarSections,
    sessionPanelSections: s.sessionPanelSections,
    sessionPanelCollapsed: s.sessionPanelCollapsed,
  };
}

type PersistedUiPrefs = ReturnType<typeof partializeUiPrefs>;

export const useUiPrefs = create<UiPrefsState>()(
  persist(
    (set) => ({
      sidebarVisible: true,
      workspaceFilesCollapsed: false,
      sidebarWidth: SIDEBAR_DEFAULT_WIDTH,
      rightClickHintDismissed: false,
      dontWarnOnTuningChange: false,
      collapsedSidebarSections: {},
      sessionPanelSections: {},
      sessionPanelCollapsed: false,
      toggleSidebar: () => set((s) => ({ sidebarVisible: !s.sidebarVisible })),
      setSidebarVisible: (visible) => set({ sidebarVisible: visible }),
      setWorkspaceFilesCollapsed: (collapsed) => set({ workspaceFilesCollapsed: collapsed }),
      setSidebarWidth: (width) => set({ sidebarWidth: clampSidebarWidth(width) }),
      dismissRightClickHint: () => set({ rightClickHintDismissed: true }),
      dismissTuningChangeWarning: () => set({ dontWarnOnTuningChange: true }),
      toggleSidebarSection: (section) =>
        set((s) => ({
          collapsedSidebarSections: {
            ...s.collapsedSidebarSections,
            [section]: !isSidebarSectionCollapsed(s.collapsedSidebarSections, section),
          },
        })),
      toggleSessionPanelSection: (id) =>
        set((s) => ({
          sessionPanelSections: {
            ...s.sessionPanelSections,
            [id]: !isSessionPanelSectionOpen(s.sessionPanelSections, id),
          },
        })),
      expandSessionPanelSection: (id) =>
        set((s) => ({ sessionPanelSections: { ...s.sessionPanelSections, [id]: true } })),
      setSessionPanelCollapsed: (collapsed) => set({ sessionPanelCollapsed: collapsed }),
    }),
    {
      name: 'mf:ui-prefs',
      version: 3,
      partialize: partializeUiPrefs,
      migrate: (persisted, version): PersistedUiPrefs => {
        if (version >= 3 || persisted === null || typeof persisted !== 'object') {
          return persisted as PersistedUiPrefs;
        }
        const next = { ...(persisted as Record<string, unknown>) };
        if (version < 2) {
          // v2 retired the bottom Context/Skills/Agents panel; its two keys are
          // dropped so a stale tab/height can never rehydrate into the new panel.
          delete next.bottomPanelTab;
          delete next.bottomPanelHeight;
        }
        // v3 retired the right InspectorPane — the Files tree lives inside the
        // workspace surface now, with its own collapse flag (default expanded).
        delete next.inspectorVisible;
        return next as PersistedUiPrefs;
      },
    },
  ),
);
