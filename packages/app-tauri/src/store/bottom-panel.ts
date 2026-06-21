/**
 * bottom-panel store — active tab + persisted height for the sidebar's bottom
 * Context/Skills/Agents panel. Mirrors store/theme.ts's localStorage helper for
 * cross-reload persistence. The store has no DOM access, so it clamps height to a
 * static fallback ceiling; the resize handle clamps against the live sidebar
 * height (clientHeight - 200) before calling setHeight.
 */
import { create } from 'zustand';

export type BottomPanelTab = 'context' | 'skills' | 'agents';

export const BOTTOM_PANEL_MIN_HEIGHT = 120;
export const BOTTOM_PANEL_DEFAULT_HEIGHT = 280;
export const BOTTOM_PANEL_MAX_FALLBACK = 600;

const TAB_KEY = 'mf.bottomPanel.tab';
const HEIGHT_KEY = 'mf.bottomPanel.height';

export function clampBottomPanelHeight(height: number, maxHeight: number): number {
  return Math.max(BOTTOM_PANEL_MIN_HEIGHT, Math.min(maxHeight, height));
}

function persist(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore: persistence is best-effort */
  }
}

function readTab(): BottomPanelTab {
  try {
    const v = localStorage.getItem(TAB_KEY);
    if (v === 'context' || v === 'skills' || v === 'agents') return v;
  } catch {
    /* ignore: fall through to default */
  }
  return 'context';
}

function readHeight(): number {
  try {
    const v = Number(localStorage.getItem(HEIGHT_KEY));
    if (Number.isFinite(v) && v > 0) return clampBottomPanelHeight(v, BOTTOM_PANEL_MAX_FALLBACK);
  } catch {
    /* ignore: fall through to default */
  }
  return BOTTOM_PANEL_DEFAULT_HEIGHT;
}

interface BottomPanelState {
  tab: BottomPanelTab;
  height: number;
  setTab: (tab: BottomPanelTab) => void;
  setHeight: (height: number) => void;
}

export const useBottomPanel = create<BottomPanelState>((set) => ({
  tab: readTab(),
  height: readHeight(),
  setTab: (tab) => {
    persist(TAB_KEY, tab);
    set({ tab });
  },
  setHeight: (height) => {
    const clamped = clampBottomPanelHeight(height, BOTTOM_PANEL_MAX_FALLBACK);
    persist(HEIGHT_KEY, String(clamped));
    set({ height: clamped });
  },
}));
