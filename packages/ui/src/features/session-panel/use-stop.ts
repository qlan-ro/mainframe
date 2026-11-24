import { useEffect, useRef, useState } from 'react';
import { errorMessage } from '@/lib/error-message';
import { mfToast } from '@/lib/toast';

/** How long a Stop that went through may take to show before it can be asked for again. */
const STOP_RETRY_MS = 10_000;

/** One Stop at a time: until the work ends, the request fails, or it had time to take effect. */
export function useStop(title: string, request: (() => Promise<void>) | undefined) {
  const [stopping, setStopping] = useState(false);
  const pending = useRef(false);
  const retry = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(retry.current), []);
  const release = () => {
    pending.current = false;
    setStopping(false);
  };
  const stop = async () => {
    if (!request || pending.current) return;
    pending.current = true;
    setStopping(true);
    try {
      await request();
      mfToast.success(`Stopped “${title}”`);
      retry.current = setTimeout(release, STOP_RETRY_MS);
    } catch (error) {
      release();
      mfToast.error(`Could not stop “${title}”`, { description: errorMessage(error) });
    }
  };
  return { onStop: request && (() => void stop()), stopping: stopping && request !== undefined };
}
