import { useEffect, useState } from 'react';
import type { UpdateStatus } from '../types/global.js';

export function useUpdateStatus(): UpdateStatus | null {
  const [status, setStatus] = useState<UpdateStatus | null>(null);

  useEffect(() => {
    const api = (window as Window & typeof globalThis).mainframe?.updates;
    if (!api) return;

    let unsub: (() => void) | undefined;
    try {
      unsub = api.onStatus(setStatus);
    } catch (err) {
      console.warn('[useUpdateStatus] failed to subscribe to update status', err);
    }

    return () => {
      try {
        unsub?.();
      } catch {
        /* cleanup best-effort */
      }
    };
  }, []);

  return status;
}
