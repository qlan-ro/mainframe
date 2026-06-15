import { useEffect } from 'react';
import { emitSurfaceIntent } from '@/store/surface-intents';

/**
 * Registers global keyboard shortcuts for overlay surfaces.
 * - Cmd/Ctrl+O → open-search-palette
 * - Cmd/Ctrl+Shift+R → open-review
 * Mirrors the AppShell:56-65 settings hotkey pattern.
 */
export function useGlobalOverlayHotkeys(): void {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && !e.shiftKey && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        emitSurfaceIntent({ type: 'open-search-palette' });
      } else if (mod && e.shiftKey && e.key.toLowerCase() === 'r') {
        e.preventDefault();
        emitSurfaceIntent({ type: 'open-review' });
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
