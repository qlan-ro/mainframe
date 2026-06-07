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
 */
import { useEffect, useRef } from 'react';
import { useAssistantRuntime, useAuiState } from '@assistant-ui/react';
import type { Chat } from '@qlan-ro/mainframe-types';
import { daemonWs } from '../../../lib/daemon/ws-client';
import { useUnreadStore } from '../../../store/unread-store';
import { useSessionFilters } from '../../../store/session-filters';
import { createSessionListRouter } from './session-list-router';

interface ActiveThreadItem {
  id: string;
  status?: string;
  custom?: { projectId?: string };
}

export function useSessionListRouter(): void {
  const runtime = useAssistantRuntime();
  const mainThreadId = useAuiState((s) => s.threads.mainThreadId);
  const threadItems = useAuiState((s) => s.threads.threadItems as unknown as ActiveThreadItem[]);

  // Static WS → list wiring; created once, disposed on unmount.
  useEffect(() => {
    const router = createSessionListRouter(daemonWs, {
      onReload: () => void runtime.threads.reload(),
      onChatUpdated: (_chat: Chat) => void runtime.threads.reload(),
      onMarkUnread: (id) => useUnreadStore.getState().markUnread(id),
    });
    return () => router.dispose();
  }, [runtime]);

  // Active-thread side-effects: unread clear, cross-project filter clear,
  // archived-active fallback. Guarded so each fires once per active change.
  const lastActiveRef = useRef<string | null>(null);
  useEffect(() => {
    if (mainThreadId == null) return;
    const active = threadItems.find((t) => t.id === mainThreadId);

    if (active != null && active.status === 'archived') {
      const fallback = threadItems.find((t) => t.id !== mainThreadId && t.status !== 'archived');
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
  }, [mainThreadId, threadItems, runtime]);
}
