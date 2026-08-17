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
  const resolvedMode = useTheme((s) => s.resolvedMode);
  useEffect(() => {
    document.documentElement.classList.toggle('dark', resolvedMode === 'dark');
    invalidateShikiTheme();
    // Keep the native window appearance on the rendered theme. macOS draws the
    // INACTIVE traffic lights for the window's appearance over our overlay
    // title bar, so a mismatch (dark window, light content) leaves them
    // invisible whenever the window is blurred.
    getHost().setWindowTheme(mode === 'system' ? null : resolvedMode);
  }, [mode, resolvedMode]);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const sync = (matchesDark: boolean) => useTheme.getState().syncSystemMode(matchesDark);
    const onChange = (event: MediaQueryListEvent) => sync(event.matches);
    sync(mediaQuery.matches);
    mediaQuery.addEventListener('change', onChange);
    return () => mediaQuery.removeEventListener('change', onChange);
  }, []);

  const uiScale = useTheme((s) => s.uiScale);
  useEffect(() => {
    getHost().setZoom(UI_SCALE_FACTORS[uiScale]);
  }, [uiScale]);

  return null;
}
