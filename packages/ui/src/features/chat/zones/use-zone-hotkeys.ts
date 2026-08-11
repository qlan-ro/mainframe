/**
 * ⌘\ / Ctrl+\ closes the VISIBLE split (Claude Code desktop's binding): the
 * pair dissolves and the other chat takes the full surface. Inert with no
 * split — and with a PARKED pair, which is not what the shortcut is aimed at.
 * Mounted by ChatSurface (needs the aui client for the survivor switch).
 */
import { useEffect, useRef } from 'react';
import { useAuiState, type useAui } from '@assistant-ui/react';
import { splitVisible, useZonesStore } from './zones-store';

export function useZoneHotkeys(aui: ReturnType<typeof useAui>): void {
  const mainThreadId = useAuiState((s) => s.threads.mainThreadId);
  const mainRef = useRef(mainThreadId);
  mainRef.current = mainThreadId;

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey) || e.key !== '\\') return;
      const store = useZonesStore.getState();
      if (!splitVisible(store.zones, mainRef.current) || store.zones == null) return;
      e.preventDefault();
      const survivor = store.zones[store.focusedIndex === 0 ? 1 : 0];
      store.closeSplit();
      aui.threads.switchToThread(survivor);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [aui]);
}
