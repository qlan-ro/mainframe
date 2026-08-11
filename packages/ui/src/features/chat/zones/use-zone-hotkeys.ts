/**
 * ⌘\ / Ctrl+\ closes the FOCUSED zone (Claude Code desktop's binding): the
 * split collapses and the other chat takes the full surface. Inert outside a
 * split. Mounted by ChatSurface (needs the aui client for the survivor switch).
 */
import { useEffect } from 'react';
import type { useAui } from '@assistant-ui/react';
import { useZonesStore } from './zones-store';

export function useZoneHotkeys(aui: ReturnType<typeof useAui>): void {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey) || e.key !== '\\') return;
      const store = useZonesStore.getState();
      if (store.zones == null) return;
      e.preventDefault();
      const survivor = store.zones[store.focusedIndex === 0 ? 1 : 0];
      store.closeSplit();
      aui.threads.switchToThread(survivor);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [aui]);
}
