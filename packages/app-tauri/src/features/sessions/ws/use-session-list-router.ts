/**
 * useSessionListRouter — React glue around SessionListRouter (Task 7.3).
 *
 * Must run UNDER <AssistantRuntimeProvider> so it can reach the live thread
 * list + active thread. Applies the cross-cutting list side-effects (fix B9):
 *
 *   chat.created / chat.ended           → runtime.threads.reload()
 *   chat.updated                        → runtime.threads.reload() (idempotent;
 *                                          re-derives custom from the daemon)
 *   chat.notification / permission(notify) → unread.markUnread()
 *
 * On every active-thread change it also: clears the active chat's unread,
 * clears the project filter when the activated chat crosses projects, and
 * falls back to the first non-archived thread when the active chat was archived
 * out from under us (blank surface if none remain).
 *
 * On boot it auto-opens the most-recently-updated session ONCE (desktop parity,
 * renderer `useAppInit`), so the app never starts on the empty new-thread picker
 * when sessions exist. Fires only while the user is still on the boot draft —
 * never yanks them off a thread they opened or a new chat they started.
 */
import { useEffect, useMemo, useRef } from 'react';
import { useAssistantRuntime, useAuiState } from '@assistant-ui/react';
import type { Chat } from '@qlan-ro/mainframe-types';
import { daemonWs } from '../../../lib/daemon/ws-client';
import { useUnreadStore } from '../../../store/unread-store';
import { useSessionFilters } from '../../../store/session-filters';
import { threadItemsToSessionItems } from '../view-model/chat-to-thread-custom';
import { pickInitialSession } from '../view-model/initial-session';
import { createSessionListRouter } from './session-list-router';

export function useSessionListRouter(): void {
  const runtime = useAssistantRuntime();
  const mainThreadId = useAuiState((s) => s.threads.mainThreadId);
  // Select the stable store-scope threadItems array; project to SessionItem[]
  // outside the selector (a fresh array would loop useAuiState's Object.is).
  const threadItems = useAuiState((s) => s.threads.threadItems);
  const items = useMemo(() => threadItemsToSessionItems(threadItems), [threadItems]);

  // Keep a ref so the router callback (created once in [runtime] effect) can
  // read the current active thread id without closing over a stale value.
  const mainThreadIdRef = useRef<string | null>(null);
  useEffect(() => {
    mainThreadIdRef.current = mainThreadId ?? null;
  }, [mainThreadId]);

  // Static WS → list wiring; created once, disposed on unmount.
  useEffect(() => {
    const router = createSessionListRouter(daemonWs, {
      onReload: () => void runtime.threads.reload(),
      onChatUpdated: (_chat: Chat) => void runtime.threads.reload(),
      onMarkUnread: (id) => {
        // Skip marking unread when the notification is for the active thread —
        // the active-thread effect already clears unread on focus, so marking
        // it here would leave a stale dot until the next thread switch.
        if (id === mainThreadIdRef.current) return;
        useUnreadStore.getState().markUnread(id);
      },
    });
    return () => router.dispose();
  }, [runtime]);

  // Active-thread side-effects: unread clear, cross-project filter clear,
  // archived-active fallback. Guarded so each fires once per active change.
  const lastActiveRef = useRef<string | null>(null);
  useEffect(() => {
    if (mainThreadId == null) return;
    const active = items.find((t) => t.id === mainThreadId);

    if (active != null && active.status === 'archived') {
      const fallback = items.find((t) => t.id !== mainThreadId && t.status !== 'archived');
      if (fallback != null) runtime.threads.switchToThread(fallback.id);
      return;
    }

    if (mainThreadId === lastActiveRef.current) return;
    lastActiveRef.current = mainThreadId;

    useUnreadStore.getState().clearUnread(mainThreadId);

    const { filterProjectId, setFilterProjectId } = useSessionFilters.getState();
    const projectId = active?.custom?.projectId;
    if (filterProjectId != null && projectId != null && projectId !== filterProjectId) {
      setFilterProjectId(null);
    }
  }, [mainThreadId, items, runtime]);

  // Boot auto-select: open the most-recent session once the list first loads, so
  // the app doesn't land on the empty new-thread picker. One-shot — consumed on
  // the first non-empty list — and only while the user is still on the boot draft
  // (mainThreadId null or a __LOCALID_* new thread), so it never overrides a
  // thread the user has already opened or a new chat they deliberately started.
  const didAutoSelectRef = useRef(false);
  useEffect(() => {
    if (didAutoSelectRef.current || items.length === 0) return;
    didAutoSelectRef.current = true;

    const onBootDraft = mainThreadId == null || mainThreadId.startsWith('__LOCALID_');
    if (!onBootDraft) return;

    const target = pickInitialSession(items);
    if (target != null && target !== mainThreadId) {
      runtime.threads.switchToThread(target);
    }
  }, [items, mainThreadId, runtime]);
}
