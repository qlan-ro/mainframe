import { useEffect } from 'react';
import { useFindInChatStore } from './find-in-chat-store';
import { shouldOpenFind } from './should-open-find';

/**
 * Cmd/Ctrl+F → open the chat Find bar. Mounted with ChatThread so it only exists
 * while a chat is shown. Exempts CodeMirror (`.cm-editor`) targets so the editor
 * keeps its CM6 search. The window listener has no React subscription, so reading
 * the store via getState() here is the one sanctioned reach-through.
 */
export function useFindHotkey(): void {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod || e.key.toLowerCase() !== 'f') return;
      if (!shouldOpenFind(e.target)) return;
      e.preventDefault();
      useFindInChatStore.getState().open();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
