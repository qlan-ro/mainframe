import { useEffect } from 'react';
import { useTheme, UI_SCALE_FACTORS } from '@/store/theme';
import { invalidateShikiTheme } from '@/lib/shiki-highlighter';
import { getHost } from '@/lib/host';

/**
 * Maintains the GLOBAL appearance mode on <html> for runtime changes (the
 * `.dark` class). Initial paint is handled by applyStoredTheme() in main.tsx
 * (FOUC guard); this effect only reacts to subsequent store changes. Renders
 * nothing.
 */
export function ThemeEffect() {
  const mode = useTheme((s) => s.mode);
  useEffect(() => {
    document.documentElement.classList.toggle('dark', mode === 'dark');
    invalidateShikiTheme();
  }, [mode]);

  const uiScale = useTheme((s) => s.uiScale);
  useEffect(() => {
    getHost().setZoom(UI_SCALE_FACTORS[uiScale]);
  }, [uiScale]);

  return null;
}
