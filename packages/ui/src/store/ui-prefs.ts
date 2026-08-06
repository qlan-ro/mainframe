/**
 * ui-prefs — the single persisted store for global UI chrome.
 *
 * Owns sidebar/inspector visibility, the committed sidebar width, and the
 * session panel's per-section open state. Persisted to localStorage under
 * `mf:ui-prefs` via zustand's persist middleware (mirrors store/tutorial.ts).
 * The bottom Context/Skills/Agents panel's tab + height still live here as
 * state but are no longer persisted — v2 strips them. Per-session surface
 * layout is NOT here — it stays
 * in-memory in store/layout.ts (live PTY/preview refs make it unsafe to persist).
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { clampSidebarWidth } from '@v2/components/ui/sidebar';

/** Matches the v2 sidebar's `SIDEBAR_WIDTH` (16rem) — the un-dragged default. */
const SIDEBAR_DEFAULT_WIDTH = 256;

export type BottomPanelTab = 'context' | 'skills' | 'agents';

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

export const BOTTOM_PANEL_MIN_HEIGHT = 120;
export const BOTTOM_PANEL_DEFAULT_HEIGHT = 280;
export const BOTTOM_PANEL_MAX_FALLBACK = 600;

export function clampBottomPanelHeight(height: number, maxHeight: number): number {
  return Math.max(BOTTOM_PANEL_MIN_HEIGHT, Math.min(maxHeight, height));
}

interface UiPrefsState {
  sidebarVisible: boolean;
  inspectorVisible: boolean;
  sidebarWidth: number;
  bottomPanelTab: BottomPanelTab;
  bottomPanelHeight: number;
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
  toggleSidebar: () => void;
  setSidebarVisible: (visible: boolean) => void;
  toggleInspector: () => void;
  setSidebarWidth: (width: number) => void;
  setBottomPanelTab: (tab: BottomPanelTab) => void;
  setBottomPanelHeight: (height: number) => void;
  dismissRightClickHint: () => void;
  dismissTuningChangeWarning: () => void;
  toggleSidebarSection: (section: SidebarSection) => void;
  toggleSessionPanelSection: (id: SessionPanelOpenSectionId) => void;
  /** Idempotent open — a rail click that navigates to an already-open section
   *  must scroll to it, never collapse it. */
  expandSessionPanelSection: (id: SessionPanelOpenSectionId) => void;
}

/** Selector helper: a section with no recorded state is expanded by default. */
export function isSidebarSectionCollapsed(
  collapsed: Partial<Record<SidebarSection, boolean>>,
  section: SidebarSection,
): boolean {
  return collapsed[section] ?? false;
}

/** The persisted subset. `bottomPanelTab` / `bottomPanelHeight` are deliberately
 *  absent: the bottom panel is being retired, and writing them back here would
 *  make the v2 migration inert. Their state fields and setters live on until
 *  their last consumer goes. */
function partializeUiPrefs(s: UiPrefsState) {
  return {
    sidebarVisible: s.sidebarVisible,
    inspectorVisible: s.inspectorVisible,
    sidebarWidth: s.sidebarWidth,
    rightClickHintDismissed: s.rightClickHintDismissed,
    dontWarnOnTuningChange: s.dontWarnOnTuningChange,
    collapsedSidebarSections: s.collapsedSidebarSections,
    sessionPanelSections: s.sessionPanelSections,
  };
}

type PersistedUiPrefs = ReturnType<typeof partializeUiPrefs>;

export const useUiPrefs = create<UiPrefsState>()(
  persist(
    (set) => ({
      sidebarVisible: true,
      inspectorVisible: false,
      sidebarWidth: SIDEBAR_DEFAULT_WIDTH,
      bottomPanelTab: 'context',
      bottomPanelHeight: BOTTOM_PANEL_DEFAULT_HEIGHT,
      rightClickHintDismissed: false,
      dontWarnOnTuningChange: false,
      collapsedSidebarSections: {},
      sessionPanelSections: {},
      toggleSidebar: () => set((s) => ({ sidebarVisible: !s.sidebarVisible })),
      setSidebarVisible: (visible) => set({ sidebarVisible: visible }),
      toggleInspector: () => set((s) => ({ inspectorVisible: !s.inspectorVisible })),
      setSidebarWidth: (width) => set({ sidebarWidth: clampSidebarWidth(width) }),
      setBottomPanelTab: (bottomPanelTab) => set({ bottomPanelTab }),
      setBottomPanelHeight: (height) =>
        set({ bottomPanelHeight: clampBottomPanelHeight(height, BOTTOM_PANEL_MAX_FALLBACK) }),
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
    }),
    {
      name: 'mf:ui-prefs',
      version: 2,
      partialize: partializeUiPrefs,
      migrate: (persisted, version): PersistedUiPrefs => {
        if (version >= 2 || persisted === null || typeof persisted !== 'object') {
          return persisted as PersistedUiPrefs;
        }
        // v2 retires the bottom Context/Skills/Agents panel; its two keys are
        // dropped so a stale tab/height can never rehydrate into the new panel.
        const next = { ...(persisted as Record<string, unknown>) };
        delete next.bottomPanelTab;
        delete next.bottomPanelHeight;
        return next as PersistedUiPrefs;
      },
    },
  ),
);
