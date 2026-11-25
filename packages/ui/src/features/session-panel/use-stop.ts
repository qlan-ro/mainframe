import { useCallback, useEffect, useRef, useState } from 'react';
import { errorMessage } from '@/lib/error-message';
import { mfToast } from '@/lib/toast';

/** How long a Stop that went through may take to show before it can be asked for again. */
const STOP_RETRY_MS = 10_000;

/** One Stop at a time: until the work ends, the request fails, or it had time to take effect. */
export function useStop(title: string, request: (() => Promise<void>) | undefined) {
  const [stopping, setStopping] = useState(false);
  const pending = useRef(false);
  const retry = useRef<ReturnType<typeof setTimeout>>(undefined);
  /** Which Stop this is: one whose work ended must not release the next. */
  const turn = useRef(0);
  const release = useCallback(() => {
    clearTimeout(retry.current);
    turn.current++;
    pending.current = false;
    setStopping(false);
  }, []);
  const ended = request === undefined;
  useEffect(() => {
    if (ended) release();
  }, [ended, release]);
  useEffect(() => () => clearTimeout(retry.current), []);
  const stop = async () => {
    if (!request || pending.current) return;
    pending.current = true;
    setStopping(true);
    const mine = turn.current;
    try {
      await request();
      mfToast.success(`Stopped “${title}”`);
      if (turn.current === mine) retry.current = setTimeout(release, STOP_RETRY_MS);
    } catch (error) {
      if (turn.current === mine) release();
      mfToast.error(`Could not stop “${title}”`, { description: errorMessage(error) });
    }
  };
  return { onStop: request && (() => void stop()), stopping: stopping && request !== undefined };
}
