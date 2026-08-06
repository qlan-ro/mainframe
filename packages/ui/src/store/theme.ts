import { create } from 'zustand';
import { getHost } from '@/lib/host';

export type ThemeMode = 'light' | 'dark';
export type UiScale = 'compact' | 'normal' | 'large';

const MODE_KEY = 'mf-theme';
const UI_SCALE_KEY = 'mf-ui-scale';

const UI_SCALES: readonly UiScale[] = ['compact', 'normal', 'large'];

/** Native page-zoom factors. Normal is crisp un-zoomed (dominant text = the raw
 *  13px body token); Compact/Large nudge the whole surface so dominant text
 *  reads ≈ 12 / 13 / 15 px across compact / normal / large. */
export const UI_SCALE_FACTORS: Record<UiScale, number> = {
  compact: 0.92,
  normal: 1.0,
  large: 1.15,
};

function readMode(): ThemeMode {
  try {
    return localStorage.getItem(MODE_KEY) === 'dark' ? 'dark' : 'light';
  } catch {
    /* private-mode / unavailable storage — fall back to light */
    return 'light';
  }
}

function readUiScale(): UiScale {
  try {
    const v = localStorage.getItem(UI_SCALE_KEY);
    return UI_SCALES.includes(v as UiScale) ? (v as UiScale) : 'normal';
  } catch {
    return 'normal';
  }
}

/**
 * Apply the persisted UI scale via the host's native page zoom (Tauri
 * `webview.setZoom` / Electron `webFrame.setZoomFactor`; no-op in browser).
 * Called from main.tsx at boot — a brief scale-pop on launch is acceptable.
 * Page zoom (NOT the CSS `zoom` property) reinterprets the viewport, so the
 * 100vh shell does not overflow.
 */
export function applyStoredScale(): void {
  getHost().setZoom(UI_SCALE_FACTORS[readUiScale()]);
}

function persist(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore: persistence is best-effort */
  }
}

/**
 * Apply the persisted mode to <html> synchronously. Called from main.tsx BEFORE
 * React mounts to avoid a flash of the wrong theme (FOUC). `data-scheme` is
 * removed unconditionally: the ocean/velvet schemes are gone, and a value
 * persisted by an older build must not linger on the root.
 */
export function applyStoredTheme(): void {
  const root = document.documentElement;
  root.classList.toggle('dark', readMode() === 'dark');
  root.removeAttribute('data-scheme');
}

interface ThemeState {
  mode: ThemeMode;
  uiScale: UiScale;
  toggle: () => void;
  setMode: (mode: ThemeMode) => void;
  setUiScale: (uiScale: UiScale) => void;
}

export const useTheme = create<ThemeState>((set, get) => ({
  mode: readMode(),
  uiScale: readUiScale(),
  toggle: () => get().setMode(get().mode === 'dark' ? 'light' : 'dark'),
  setMode: (mode) => {
    persist(MODE_KEY, mode);
    set({ mode });
  },
  setUiScale: (uiScale) => {
    persist(UI_SCALE_KEY, uiScale);
    set({ uiScale });
  },
}));
