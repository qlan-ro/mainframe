import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type ThemeId = 'dark-claude' | 'dark-codex' | 'dark-gemini' | 'dark-opencode';

export const THEMES: { id: ThemeId; label: string; accent: string }[] = [
  { id: 'dark-claude', label: 'Dark Claude', accent: 'oklch(0.705 0.187 48)' },
  { id: 'dark-codex', label: 'Dark Codex', accent: 'oklch(0.696 0.149 163)' },
  { id: 'dark-gemini', label: 'Dark Gemini', accent: 'oklch(0.588 0.198 262)' },
  { id: 'dark-opencode', label: 'Dark OpenCode', accent: 'oklch(0.627 0.233 304)' },
];

function applyThemeClass(themeId: ThemeId): void {
  const el = document.documentElement;
  el.classList.remove(...THEMES.map((t) => `theme-${t.id}`));
  if (themeId !== 'dark-claude') {
    el.classList.add(`theme-${themeId}`);
  }
}

interface ThemeState {
  themeId: ThemeId;
  setTheme: (id: ThemeId) => void;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      themeId: 'dark-claude',
      setTheme: (id) => {
        applyThemeClass(id);
        set({ themeId: id });
      },
    }),
    {
      name: 'mainframe-theme',
      onRehydrate: () => (state) => {
        if (state) applyThemeClass(state.themeId);
      },
    },
  ),
);
