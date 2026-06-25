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
import { clampSidebarWidth, SIDEBAR_EXPANDED_WIDTH } from '@/layout/SidebarShell';

export type BottomPanelTab = 'context' | 'skills' | 'agents';

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
  toggleSidebar: () => void;
  toggleInspector: () => void;
  setSidebarWidth: (width: number) => void;
  setBottomPanelTab: (tab: BottomPanelTab) => void;
  setBottomPanelHeight: (height: number) => void;
}

export const useUiPrefs = create<UiPrefsState>()(
  persist(
    (set) => ({
      sidebarVisible: true,
      inspectorVisible: false,
      sidebarWidth: SIDEBAR_EXPANDED_WIDTH,
      bottomPanelTab: 'context',
      bottomPanelHeight: BOTTOM_PANEL_DEFAULT_HEIGHT,
      toggleSidebar: () => set((s) => ({ sidebarVisible: !s.sidebarVisible })),
      toggleInspector: () => set((s) => ({ inspectorVisible: !s.inspectorVisible })),
      setSidebarWidth: (width) => set({ sidebarWidth: clampSidebarWidth(width) }),
      setBottomPanelTab: (bottomPanelTab) => set({ bottomPanelTab }),
      setBottomPanelHeight: (height) =>
        set({ bottomPanelHeight: clampBottomPanelHeight(height, BOTTOM_PANEL_MAX_FALLBACK) }),
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
      }),
    },
  ),
);
