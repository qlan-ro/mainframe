import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { getActiveDaemon } from '@/lib/daemon/active-daemon';
import { errorMessage } from '@/lib/error-message';
import { mfToast } from '@/lib/toast';

/** How long a Stop may take to show, a request that never answers included, before it can be asked for again. */
const STOP_RETRY_MS = 10_000;

type Key = string | symbol;

/** The Stops on their way. Each one's timer also tells it from a later one. */
const pending = new Map<Key, ReturnType<typeof setTimeout>>();
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
const changed = () => listeners.forEach((listener) => listener());

function release(key: Key): void {
  if (!pending.has(key)) return;
  clearTimeout(pending.get(key));
  pending.delete(key);
  changed();
}

/** Reserved for tests: a Stop outlives the control that asked for it. */
export function resetStops(): void {
  for (const key of [...pending.keys()]) release(key);
}

/** Names a background or delegated task for `useStop`: the same one from every place that can stop it. */
export function stopKey(chatId: string | null | undefined, taskId: string): string {
  return JSON.stringify([getActiveDaemon().id, chatId, taskId]);
}

/**
 * One Stop at a time: until the work ends, the request fails, or it had time to
 * take effect. `work` names what is stopped (`stopKey`) where several controls stop
 * it, or one can leave the document and come back meanwhile.
 */
export function useStop(title: string, request: (() => Promise<void>) | undefined, work?: string) {
  const [own] = useState(() => Symbol('stop'));
  const key = work ?? own;
  const stopping = useSyncExternalStore(subscribe, () => pending.has(key));
  const stoppable = request !== undefined;
  const offered = useRef<Key>(undefined);
  useEffect(() => {
    if (!stoppable && offered.current !== undefined) release(offered.current);
    offered.current = stoppable ? key : undefined;
  }, [stoppable, key]);
  useEffect(() => () => release(own), [own]);
  const stop = async () => {
    if (!request || pending.has(key)) return;
    const mine = setTimeout(() => release(key), STOP_RETRY_MS);
    pending.set(key, mine);
    changed();
    try {
      await request();
      mfToast.success(`Stopped “${title}”`);
    } catch (error) {
      if (pending.get(key) === mine) release(key);
      mfToast.error(`Could not stop “${title}”`, { description: errorMessage(error) });
    }
  };
  return { onStop: request && (() => void stop()), stopping };
}
