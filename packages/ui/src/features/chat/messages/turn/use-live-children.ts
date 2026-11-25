import { useEffect, useMemo, useState } from 'react';
import type { BackgroundActivityTask, BackgroundTask } from '@qlan-ro/mainframe-types';
import { listBackgroundTasks } from '@/lib/api/background-tasks';
import { useChatExtrasSelector } from '../../runtime/chat-extras';
import { useSessionItems } from '../../orchestration/use-session-items';
import type { TurnModel } from '../../view-model/turn/types';
import { liveChildren, sameLive, type LiveChildren } from './live-children';

const NO_TASKS: Readonly<Record<string, BackgroundActivityTask>> = {};

/** First wait before asking again; doubles up to the last. */
const RETRY_MS = 1000;
const RETRY_MAX_MS = 30_000;

/**
 * Which call started each running background task: only the daemon's list says.
 * Asked again while it fails or doesn't name a running task yet, since an agent
 * nobody placed holds every turn open; and once more when the last one ends, for
 * how it ended. `launched`: an agent was started, whose call says only that.
 */
export function useListedTasks(
  chatId: string | undefined,
  live: Readonly<Record<string, BackgroundActivityTask>>,
  launched: boolean,
): readonly BackgroundTask[] {
  const [listed, setListed] = useState<readonly BackgroundTask[]>([]);
  const ids = Object.keys(live).sort().join(' ');
  useEffect(() => {
    if (!chatId || (!ids && !launched) || chatId.startsWith('__LOCALID_')) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let wait = RETRY_MS;
    const retry = () => {
      timer = setTimeout(() => void ask(), wait);
      wait = Math.min(wait * 2, RETRY_MAX_MS);
    };
    const ask = async () => {
      try {
        const tasks = await listBackgroundTasks(chatId);
        if (!active) return;
        setListed(tasks);
        const named = new Set(tasks.map((task) => task.id));
        if (ids && ids.split(' ').some((id) => !named.has(id))) retry();
      } catch (error) {
        console.warn('[transcript] background task list failed', error);
        if (active) retry();
      }
    };
    void ask();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [chatId, ids, launched]);
  return listed;
}

/** Where each turn's child work stands; the same object until one of them moves. */
export function useLiveChildren(model: TurnModel, chatId: string | undefined): LiveChildren {
  const sessions = useSessionItems();
  const live = useChatExtrasSelector((extras) => extras?.state.backgroundTasks) ?? NO_TASKS;
  const launched = useMemo(
    () => [...model.turns.values()].some((turn) => turn.children.some((child) => child.launched)),
    [model],
  );
  const listed = useListedTasks(chatId, live, launched);
  const next = useMemo(() => liveChildren(model, { sessions, live, listed }), [model, sessions, live, listed]);
  const [kept, setKept] = useState(next);
  if (kept !== next && !sameLive(kept, next)) setKept(next);
  return kept;
}
