/**
 * The project's most recent sessions for a new session's empty state (K11),
 * off the same live list the sidebar shows.
 */
import { useMemo } from 'react';
import { useAuiState } from '@assistant-ui/react';
import { useStableList } from '@/lib/use-stable-list';
import { useSessionListLoadState } from '../runtime/list-load-state';
import { useThreadItems } from '../runtime/use-thread-items';
import type { SessionItem } from '../view-model/chat-to-thread-custom';
import { listedThreadItemsToSessionItems } from '../view-model/task-chats';

const SHOWN = 3;

export function recentSessions(items: readonly SessionItem[], projectId: string): SessionItem[] {
  return items
    .filter((item) => item.custom.projectId === projectId)
    .sort((a, b) => b.custom.updatedAt - a.custom.updatedAt)
    .slice(0, SHOWN);
}

export interface RecentSessions {
  sessions: readonly SessionItem[];
  /** Only with nothing to show: a list that failed to refresh still shows what it has. */
  state: 'ready' | 'loading' | 'failed';
}

export function useRecentSessions(projectId: string | null): RecentSessions {
  const threadItems = useThreadItems();
  const loading = useAuiState((s) => s.threads.isLoading);
  const { loaded, failed } = useSessionListLoadState();
  const sessions = useStableList(
    useMemo(
      () => (projectId == null ? [] : recentSessions(listedThreadItemsToSessionItems(threadItems), projectId)),
      [threadItems, projectId],
    ),
  );
  if (sessions.length > 0) return { sessions, state: 'ready' };
  return { sessions, state: loading && !loaded ? 'loading' : failed ? 'failed' : 'ready' };
}
