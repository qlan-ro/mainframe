import { useEffect, useMemo, useState } from 'react';
import type { BackgroundActivityTask, BackgroundTask } from '@qlan-ro/mainframe-types';
import { listBackgroundTasks } from '@/lib/api/background-tasks';
import { useChatExtrasSelector } from '../../runtime/chat-extras';
import { useSessionItems } from '../../orchestration/use-session-items';
import type { TurnModel } from '../../view-model/turn/types';
import { liveChildren, sameLive, type LiveChildren } from './live-children';

const NO_TASKS: Readonly<Record<string, BackgroundActivityTask>> = {};

/** Which call started each running background task: only the daemon's list says. */
function useListedTasks(
  chatId: string | undefined,
  live: Readonly<Record<string, BackgroundActivityTask>>,
): readonly BackgroundTask[] {
  const [listed, setListed] = useState<readonly BackgroundTask[]>([]);
  const ids = Object.keys(live).sort().join(' ');
  useEffect(() => {
    if (!chatId || !ids || chatId.startsWith('__LOCALID_')) return;
    let active = true;
    listBackgroundTasks(chatId).then(
      (tasks) => active && setListed(tasks),
      (error: unknown) => console.warn('[transcript] background task list failed', error),
    );
    return () => {
      active = false;
    };
  }, [chatId, ids]);
  return listed;
}

/** Where each turn's child work stands; the same object until one of them moves. */
export function useLiveChildren(model: TurnModel, chatId: string | undefined): LiveChildren {
  const sessions = useSessionItems();
  const live = useChatExtrasSelector((extras) => extras?.state.backgroundTasks) ?? NO_TASKS;
  const listed = useListedTasks(chatId, live);
  const next = useMemo(() => liveChildren(model, { sessions, live, listed }), [model, sessions, live, listed]);
  const [kept, setKept] = useState(next);
  if (kept !== next && !sameLive(kept, next)) setKept(next);
  return kept;
}
