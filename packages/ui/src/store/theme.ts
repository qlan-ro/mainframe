import { create } from 'zustand';
import { getHost } from '@/lib/host';

export type ThemeMode = 'light' | 'dark';
export type ColorScheme = 'classic' | 'ocean' | 'velvet';
export type WindowStyle = 'unified' | 'split' | 'glass';
export type UiScale = 'compact' | 'normal' | 'large';

const MODE_KEY = 'mf-theme';
const SCHEME_KEY = 'mf-scheme';
const WINDOW_STYLE_KEY = 'mf-window-style';
const UI_SCALE_KEY = 'mf-ui-scale';

const SCHEMES: readonly ColorScheme[] = ['classic', 'ocean', 'velvet'];
const WINDOW_STYLES: readonly WindowStyle[] = ['unified', 'split', 'glass'];
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

function readScheme(): ColorScheme {
  try {
    const v = localStorage.getItem(SCHEME_KEY);
    return SCHEMES.includes(v as ColorScheme) ? (v as ColorScheme) : 'classic';
  } catch {
    return 'classic';
  }
}

function readWindowStyle(): WindowStyle {
  try {
    const v = localStorage.getItem(WINDOW_STYLE_KEY);
    return WINDOW_STYLES.includes(v as WindowStyle) ? (v as WindowStyle) : 'glass';
  } catch {
    return 'glass';
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
 * Apply the persisted mode + scheme to <html> synchronously. Called from main.tsx
 * BEFORE React mounts to avoid a flash of the wrong theme (FOUC). Window style is
 * shell-scoped and applied at render time, so it is intentionally NOT applied here.
 */
export function applyStoredTheme(): void {
  const root = document.documentElement;
  root.classList.toggle('dark', readMode() === 'dark');
  const scheme = readScheme();
  if (scheme === 'classic') root.removeAttribute('data-scheme');
  else root.setAttribute('data-scheme', scheme);
}

interface ThemeState {
  mode: ThemeMode;
  scheme: ColorScheme;
  windowStyle: WindowStyle;
  uiScale: UiScale;
  toggle: () => void;
  setMode: (mode: ThemeMode) => void;
  setScheme: (scheme: ColorScheme) => void;
  setWindowStyle: (windowStyle: WindowStyle) => void;
  setUiScale: (uiScale: UiScale) => void;
}

export const useTheme = create<ThemeState>((set, get) => ({
  mode: readMode(),
  scheme: readScheme(),
  windowStyle: readWindowStyle(),
  uiScale: readUiScale(),
  toggle: () => get().setMode(get().mode === 'dark' ? 'light' : 'dark'),
  setMode: (mode) => {
    persist(MODE_KEY, mode);
    set({ mode });
  },
  setScheme: (scheme) => {
    persist(SCHEME_KEY, scheme);
    set({ scheme });
  },
  setWindowStyle: (windowStyle) => {
    persist(WINDOW_STYLE_KEY, windowStyle);
    set({ windowStyle });
  },
  setUiScale: (uiScale) => {
    persist(UI_SCALE_KEY, uiScale);
    set({ uiScale });
  },
}));
