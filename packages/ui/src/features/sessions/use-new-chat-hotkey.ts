import { useEffect, useRef } from 'react';

/**
 * Cmd/Ctrl+N → new chat (parity with desktop's global ⌘N). Calls `onNewChat`,
 * which is wired to `runtime.threads.switchToNewThread()` — the same path as the
 * sidebar's New button (`ThreadListPrimitive.New`). Shift+N is excluded so it
 * never clobbers a future ⌘⇧N. A ref keeps the latest callback without
 * re-subscribing the window listener each render.
 */
export function useNewChatHotkey(onNewChat: () => void): void {
  const ref = useRef(onNewChat);
  ref.current = onNewChat;

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod || e.shiftKey || e.key.toLowerCase() !== 'n') return;
      e.preventDefault();
      ref.current();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
