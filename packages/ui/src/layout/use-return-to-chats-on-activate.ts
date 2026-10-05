/**
 * useReturnToChatsOnActivate — D3 seam. Leaving Tasks/Automations/Setup
 * Advisor/Settings for Chats whenever a session is actually ACTIVATED:
 * clicking a session tab, ⌘N, starting a task session, an automation's
 * "open session", a toast deep-link. All of these resolve to
 * `aui.threads.switchToThread`, which changes `mainThreadId` — so this is
 * the one seam every one of them needs.
 *
 * The initial value is skipped (a ref, not state, so it never re-renders):
 * simply booting on a non-Chats view must not get yanked back to Chats.
 * Only a CHANGE counts.
 *
 * Does NOT cover clicking the already-active session tab (no id change, so
 * `mainThreadId` never fires) — that path calls `setSidebarView('chats')`
 * directly from `use-session-tab-handlers.ts`.
 */
import { useEffect, useRef } from 'react';
import { useAuiState } from '@assistant-ui/react';
import { useUiPrefs } from '@/store/ui-prefs';

export function useReturnToChatsOnActivate(): void {
  const mainThreadId = useAuiState((s) => s.threads.mainThreadId);
  const seen = useRef(false);
  const prev = useRef(mainThreadId);

  useEffect(() => {
    if (!seen.current) {
      seen.current = true;
      prev.current = mainThreadId;
      return;
    }
    if (mainThreadId === prev.current) return;
    prev.current = mainThreadId;
    const { sidebarView, setSidebarView } = useUiPrefs.getState();
    if (sidebarView !== 'chats') setSidebarView('chats');
  }, [mainThreadId]);
}
