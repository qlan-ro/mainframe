import { create } from 'zustand';

export type ThemeMode = 'light' | 'dark';
export type ColorScheme = 'classic' | 'ocean' | 'velvet';
export type WindowStyle = 'unified' | 'split' | 'glass';

const MODE_KEY = 'mf-theme';
const SCHEME_KEY = 'mf-scheme';
const WINDOW_STYLE_KEY = 'mf-window-style';

const SCHEMES: readonly ColorScheme[] = ['classic', 'ocean', 'velvet'];
const WINDOW_STYLES: readonly WindowStyle[] = ['unified', 'split', 'glass'];

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
  toggle: () => void;
  setMode: (mode: ThemeMode) => void;
  setScheme: (scheme: ColorScheme) => void;
  setWindowStyle: (windowStyle: WindowStyle) => void;
}

export const useTheme = create<ThemeState>((set, get) => ({
  mode: readMode(),
  scheme: readScheme(),
  windowStyle: readWindowStyle(),
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
}));
