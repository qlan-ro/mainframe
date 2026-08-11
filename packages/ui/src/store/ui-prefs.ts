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
import { clampSidebarWidth } from '@/components/ui/sidebar';

/** Matches the v2 sidebar's `SIDEBAR_WIDTH` (16rem) — the un-dragged default. */
const SIDEBAR_DEFAULT_WIDTH = 256;

/** The collapsible sidebar sections. Only Projects survived the v2 shell —
 *  Sessions/Tasks scroll as one region and Tags lives in the footer now. */
export type SidebarSection = 'projects';

/** The rail's independent stacked panels, in rail/stack order. Declared here
 *  rather than in `features/session-panel/` because this store persists their
 *  open-state and `store/` must not import from `features/`. */
export type SessionPanelId = 'session' | 'activity' | 'launch' | 'tasks';

/** Open on first run: the session card alone — the other panels are opt-in. */
const SESSION_PANEL_DEFAULTS: Record<SessionPanelId, boolean> = {
  session: true,
  activity: false,
  launch: false,
  tasks: false,
};

export type SessionPanelOpen = Partial<Record<SessionPanelId, boolean>>;

/** Selector helper: a panel with no recorded state falls back to its default. */
export function isSessionPanelOpen(open: SessionPanelOpen, id: SessionPanelId): boolean {
  return open[id] ?? SESSION_PANEL_DEFAULTS[id];
}

/** The session card's collapsible sections (Summary is never collapsible). */
export type SessionPanelSectionId = 'summary' | 'plan' | 'context';

export type SessionPanelOpenSectionId = Exclude<SessionPanelSectionId, 'summary'>;

/** Context is the reference material you scan, so it starts open. */
const SESSION_PANEL_SECTION_DEFAULTS: Record<SessionPanelOpenSectionId, boolean> = {
  plan: false,
  context: true,
};

export type SessionPanelSections = Partial<Record<SessionPanelOpenSectionId, boolean>>;

/** Selector helper: a section with no recorded state falls back to its default. */
export function isSessionPanelSectionOpen(sections: SessionPanelSections, id: SessionPanelOpenSectionId): boolean {
  return sections[id] ?? SESSION_PANEL_SECTION_DEFAULTS[id];
}

interface UiPrefsState {
  sidebarVisible: boolean;
  sidebarWidth: number;
  /** Once true, the one-time "Right-click for options" pill hint is suppressed for good. */
  rightClickHintDismissed: boolean;
  /** Once true, the mid-session model/effort/feature change warning is suppressed for good. */
  dontWarnOnTuningChange: boolean;
  /** Per-section collapse state for the left sidebar's four root sections.
   *  Absent keys read as expanded (false) — see isSidebarSectionCollapsed. */
  collapsedSidebarSections: Partial<Record<SidebarSection, boolean>>;
  /** Which stacked panels are open. This store is the sole owner — absent keys
   *  read as the panel's default; see isSessionPanelOpen. */
  sessionPanelOpen: SessionPanelOpen;
  /** Per-section open state inside the session card. Absent keys read as the
   *  section's default; see isSessionPanelSectionOpen. */
  sessionPanelSections: SessionPanelSections;
  toggleSidebar: () => void;
  setSidebarVisible: (visible: boolean) => void;
  setSidebarWidth: (width: number) => void;
  dismissRightClickHint: () => void;
  dismissTuningChangeWarning: () => void;
  toggleSidebarSection: (section: SidebarSection) => void;
  toggleSessionPanel: (id: SessionPanelId) => void;
  /** Idempotent open — for controls that navigate to a panel's content. */
  openSessionPanel: (id: SessionPanelId) => void;
  toggleSessionPanelSection: (id: SessionPanelOpenSectionId) => void;
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
    sidebarWidth: s.sidebarWidth,
    rightClickHintDismissed: s.rightClickHintDismissed,
    dontWarnOnTuningChange: s.dontWarnOnTuningChange,
    collapsedSidebarSections: s.collapsedSidebarSections,
    sessionPanelOpen: s.sessionPanelOpen,
    sessionPanelSections: s.sessionPanelSections,
  };
}

type PersistedUiPrefs = ReturnType<typeof partializeUiPrefs>;

export const useUiPrefs = create<UiPrefsState>()(
  persist(
    (set) => ({
      sidebarVisible: true,
      sidebarWidth: SIDEBAR_DEFAULT_WIDTH,
      rightClickHintDismissed: false,
      dontWarnOnTuningChange: false,
      collapsedSidebarSections: {},
      sessionPanelOpen: {},
      sessionPanelSections: {},
      toggleSidebar: () => set((s) => ({ sidebarVisible: !s.sidebarVisible })),
      setSidebarVisible: (visible) => set({ sidebarVisible: visible }),
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
      toggleSessionPanel: (id) =>
        set((s) => ({
          sessionPanelOpen: { ...s.sessionPanelOpen, [id]: !isSessionPanelOpen(s.sessionPanelOpen, id) },
        })),
      openSessionPanel: (id) => set((s) => ({ sessionPanelOpen: { ...s.sessionPanelOpen, [id]: true } })),
      toggleSessionPanelSection: (id) =>
        set((s) => ({
          sessionPanelSections: {
            ...s.sessionPanelSections,
            [id]: !isSessionPanelSectionOpen(s.sessionPanelSections, id),
          },
        })),
    }),
    {
      name: 'mf:ui-prefs',
      version: 5,
      partialize: partializeUiPrefs,
      migrate: (persisted, version): PersistedUiPrefs => {
        if (version >= 5 || persisted === null || typeof persisted !== 'object') {
          return persisted as PersistedUiPrefs;
        }
        const next = { ...(persisted as Record<string, unknown>) };
        if (version < 2) {
          // v2 retired the bottom Context/Skills/Agents panel; its two keys are
          // dropped so a stale tab/height can never rehydrate into the new panel.
          delete next.bottomPanelTab;
          delete next.bottomPanelHeight;
        }
        if (version < 4) {
          // v3 retired the right InspectorPane; v4 retired its short-lived docked
          // successor — the Files tree is a transient floating panel now
          // (store/workspace-files-panel), so neither flag persists.
          delete next.inspectorVisible;
          delete next.workspaceFilesCollapsed;
        }
        // v5 split Activity/Launch out of the session card into stacked panels:
        // their old section bits become panel bits, and the whole-card collapse
        // becomes the session panel's own open bit.
        const sections = { ...(next.sessionPanelSections as Record<string, unknown> | undefined) };
        next.sessionPanelOpen = {
          ...(typeof sections.activity === 'boolean' ? { activity: sections.activity } : {}),
          ...(typeof sections.launch === 'boolean' ? { launch: sections.launch } : {}),
          ...(next.sessionPanelCollapsed === true ? { session: false } : {}),
        };
        delete sections.activity;
        delete sections.launch;
        next.sessionPanelSections = sections;
        delete next.sessionPanelCollapsed;
        return next as PersistedUiPrefs;
      },
    },
  ),
);
