import { useEffect } from 'react';
import { useTheme, UI_SCALE_FACTORS } from '@/store/theme';
import { invalidateShikiTheme } from '@/lib/shiki-highlighter';

/**
 * Maintains the GLOBAL appearance axes on <html> for runtime changes:
 *   - mode  → toggles the `.dark` class
 *   - scheme → sets/removes `data-scheme`
 * Initial paint is handled by applyStoredTheme() in main.tsx (FOUC guard); this
 * effect only reacts to subsequent store changes. Window style is shell-scoped
 * (see AppShell), not handled here. Renders nothing.
 */
export function ThemeEffect() {
  const mode = useTheme((s) => s.mode);
  const scheme = useTheme((s) => s.scheme);
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', mode === 'dark');
    if (scheme === 'classic') root.removeAttribute('data-scheme');
    else root.setAttribute('data-scheme', scheme);
    invalidateShikiTheme();
  }, [mode, scheme]);

  const uiScale = useTheme((s) => s.uiScale);
  useEffect(() => {
    document.documentElement.style.zoom = String(UI_SCALE_FACTORS[uiScale]);
  }, [uiScale]);

  return null;
}
