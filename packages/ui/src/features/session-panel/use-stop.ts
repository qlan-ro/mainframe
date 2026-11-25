import { useCallback, useEffect, useRef, useState } from 'react';
import { errorMessage } from '@/lib/error-message';
import { mfToast } from '@/lib/toast';

/** How long a Stop may take to show, a request that never answers included, before it can be asked for again. */
const STOP_RETRY_MS = 10_000;

/** One Stop at a time: until the work ends, the request fails, or it had time to take effect. */
export function useStop(title: string, request: (() => Promise<void>) | undefined) {
  const [stopping, setStopping] = useState(false);
  /** The timer of the Stop on its way, which also tells it from a later one. */
  const pending = useRef<ReturnType<typeof setTimeout>>(undefined);
  const release = useCallback(() => {
    clearTimeout(pending.current);
    pending.current = undefined;
    setStopping(false);
  }, []);
  const ended = request === undefined;
  useEffect(() => {
    if (ended) release();
  }, [ended, release]);
  useEffect(() => () => clearTimeout(pending.current), []);
  const stop = async () => {
    if (!request || pending.current !== undefined) return;
    const mine = setTimeout(release, STOP_RETRY_MS);
    pending.current = mine;
    setStopping(true);
    try {
      await request();
      mfToast.success(`Stopped “${title}”`);
    } catch (error) {
      if (pending.current === mine) release();
      mfToast.error(`Could not stop “${title}”`, { description: errorMessage(error) });
    }
  };
  return { onStop: request && (() => void stop()), stopping };
}
