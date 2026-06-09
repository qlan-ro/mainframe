import { useEffect } from 'react';
import { useTheme } from '@/store/theme';

/**
 * Applies the active theme to the document root by toggling the `.dark` class
 * (the globals.css token contract switches on it). Mounted once at the app root;
 * runs on mount and whenever the mode changes. Renders nothing.
 */
export function ThemeEffect() {
  const mode = useTheme((s) => s.mode);
  useEffect(() => {
    document.documentElement.classList.toggle('dark', mode === 'dark');
  }, [mode]);
  return null;
}
