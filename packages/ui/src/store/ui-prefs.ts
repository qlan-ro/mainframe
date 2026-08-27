/**
 * ui-prefs — the single persisted store for global UI chrome.
 *
 * Owns sidebar visibility, the committed sidebar width, and the session
 * panel's per-section open state. Persisted to localStorage under
 * `mf:ui-prefs` via zustand's persist middleware (mirrors store/tutorial.ts).
 * Per-session surface layout is NOT here — it stays in-memory in
 * store/layout.ts (live PTY/preview refs make it unsafe to persist). The
 * workspace Files sidebar's open state is scoped per project/worktree, so it
 * lives in its own store — store/workspace-files-panel — not here.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { clampSidebarWidth } from '@/components/ui/sidebar';

/** Matches the v2 sidebar's `SIDEBAR_WIDTH` (16rem) — the un-dragged default. */
const SIDEBAR_DEFAULT_WIDTH = 256;

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
  /** Once true, the mid-session model/effort/feature change warning is suppressed for good. */
  dontWarnOnTuningChange: boolean;
  /** Which stacked panels are open. This store is the sole owner — absent keys
   *  read as the panel's default; see isSessionPanelOpen. */
  sessionPanelOpen: SessionPanelOpen;
  /** Per-section open state inside the session card. Absent keys read as the
   *  section's default; see isSessionPanelSectionOpen. */
  sessionPanelSections: SessionPanelSections;
  toggleSidebar: () => void;
  setSidebarVisible: (visible: boolean) => void;
  setSidebarWidth: (width: number) => void;
  dismissTuningChangeWarning: () => void;
  toggleSessionPanel: (id: SessionPanelId) => void;
  /** Idempotent open — for controls that navigate to a panel's content. */
  openSessionPanel: (id: SessionPanelId) => void;
  toggleSessionPanelSection: (id: SessionPanelOpenSectionId) => void;
}

/** The persisted subset. */
function partializeUiPrefs(s: UiPrefsState) {
  return {
    sidebarVisible: s.sidebarVisible,
    sidebarWidth: s.sidebarWidth,
    dontWarnOnTuningChange: s.dontWarnOnTuningChange,
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
      dontWarnOnTuningChange: false,
      sessionPanelOpen: {},
      sessionPanelSections: {},
      toggleSidebar: () => set((s) => ({ sidebarVisible: !s.sidebarVisible })),
      setSidebarVisible: (visible) => set({ sidebarVisible: visible }),
      setSidebarWidth: (width) => set({ sidebarWidth: clampSidebarWidth(width) }),
      dismissTuningChangeWarning: () => set({ dontWarnOnTuningChange: true }),
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
      version: 6,
      partialize: partializeUiPrefs,
      migrate: (persisted, version): PersistedUiPrefs => {
        if (version >= 6 || persisted === null || typeof persisted !== 'object') {
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
          // successor — the Files tree became a transient floating panel, so
          // neither flag persisted at the time. (2026-08-15: it's a docked
          // sidebar again, but its open state lives in its own scoped store —
          // store/workspace-files-panel, keyed per project/worktree — not here.)
          delete next.inspectorVisible;
          delete next.workspaceFilesCollapsed;
        }
        if (version < 5) {
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
        }
        // v6 replaced the Projects section with the scope-selector dropdown: no
        // collapsible sidebar sections and no right-click affordance remain.
        delete next.collapsedSidebarSections;
        delete next.rightClickHintDismissed;
        return next as PersistedUiPrefs;
      },
    },
  ),
);
