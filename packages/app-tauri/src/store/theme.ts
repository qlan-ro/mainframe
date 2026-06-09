import { create } from 'zustand';

export type ThemeMode = 'light' | 'dark';

const STORAGE_KEY = 'mf-theme';

/** Read + validate the persisted theme; anything other than 'dark' is 'light'. */
function readStored(): ThemeMode {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'dark' ? 'dark' : 'light';
  } catch {
    /* private-mode / unavailable storage — fall back to light */
    return 'light';
  }
}

function persist(mode: ThemeMode): void {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    /* ignore: persistence is best-effort */
  }
}

interface ThemeState {
  mode: ThemeMode;
  toggle: () => void;
  setMode: (mode: ThemeMode) => void;
}

export const useTheme = create<ThemeState>((set, get) => ({
  mode: readStored(),
  toggle: () => get().setMode(get().mode === 'dark' ? 'light' : 'dark'),
  setMode: (mode) => {
    persist(mode);
    set({ mode });
  },
}));
