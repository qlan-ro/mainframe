import { useSyncExternalStore } from 'react';
import type { BackgroundTask } from '@qlan-ro/mainframe-types';
import { getActiveDaemon } from '@/lib/daemon/active-daemon';
import { errorMessage } from '@/lib/error-message';
import { mfToast } from '@/lib/toast';

/** How long a Stop may take to show, a request that never answers included, before it can be asked for again. */
const STOP_RETRY_MS = 10_000;

/** The Stops on their way. Each one's timer also tells it from a later one. */
const pending = new Map<string, ReturnType<typeof setTimeout>>();
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
const changed = () => listeners.forEach((listener) => listener());

function release(key: string): void {
  if (!pending.has(key)) return;
  clearTimeout(pending.get(key));
  pending.delete(key);
  changed();
}

/** Reserved for tests: a Stop outlives the control that asked for it. */
export function resetStops(): void {
  for (const key of [...pending.keys()]) release(key);
}

/** A run of a background task, the same from every place that can stop it. A later run of it is another. */
export function backgroundStopKey(chatId: string | undefined, task: BackgroundTask | null | undefined): string {
  return JSON.stringify([getActiveDaemon().id, chatId, task?.id, task?.startedAt]);
}

export function delegatedStopKey(parentChatId: string | null | undefined, taskId: string | undefined): string {
  return JSON.stringify([getActiveDaemon().id, parentChatId, taskId]);
}

/**
 * One Stop at a time for what `work` names, whichever control asked: until the request
 * fails, or it had time to take effect. A control may leave the document meanwhile, as
 * a row of the virtualized transcript does, or stop offering it without the work ending.
 */
export function useStop(title: string, request: (() => Promise<void>) | undefined, work: string) {
  const stopping = useSyncExternalStore(subscribe, () => pending.has(work));
  const stop = async () => {
    if (!request || pending.has(work)) return;
    const mine = setTimeout(() => release(work), STOP_RETRY_MS);
    pending.set(work, mine);
    changed();
    try {
      await request();
      mfToast.success(`Stopped “${title}”`);
    } catch (error) {
      if (pending.get(work) === mine) release(work);
      mfToast.error(`Could not stop “${title}”`, { description: errorMessage(error) });
    }
  };
  return { onStop: request && (() => void stop()), stopping: request !== undefined && stopping };
}
