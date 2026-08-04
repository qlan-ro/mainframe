/**
 * ui-prefs — the single persisted store for global UI chrome.
 *
 * Owns sidebar/inspector visibility, the committed sidebar width, and the
 * bottom Context/Skills/Agents panel's tab + height. Persisted to
 * localStorage under `mf:ui-prefs` via zustand's persist middleware (mirrors
 * store/tutorial.ts). Per-session surface layout is NOT here — it stays
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
  toggleSidebar: () => void;
  setSidebarVisible: (visible: boolean) => void;
  toggleInspector: () => void;
  setSidebarWidth: (width: number) => void;
  setBottomPanelTab: (tab: BottomPanelTab) => void;
  setBottomPanelHeight: (height: number) => void;
  dismissRightClickHint: () => void;
  dismissTuningChangeWarning: () => void;
  toggleSidebarSection: (section: SidebarSection) => void;
}

/** Selector helper: a section with no recorded state is expanded by default. */
export function isSidebarSectionCollapsed(
  collapsed: Partial<Record<SidebarSection, boolean>>,
  section: SidebarSection,
): boolean {
  return collapsed[section] ?? false;
}

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
    }),
    {
      name: 'mf:ui-prefs',
      version: 1,
      partialize: (s) => ({
        sidebarVisible: s.sidebarVisible,
        inspectorVisible: s.inspectorVisible,
        sidebarWidth: s.sidebarWidth,
        bottomPanelTab: s.bottomPanelTab,
        bottomPanelHeight: s.bottomPanelHeight,
        rightClickHintDismissed: s.rightClickHintDismissed,
        dontWarnOnTuningChange: s.dontWarnOnTuningChange,
        collapsedSidebarSections: s.collapsedSidebarSections,
      }),
    },
  ),
);
