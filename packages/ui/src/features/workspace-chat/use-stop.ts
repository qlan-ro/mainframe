import { useState } from 'react';
import { mfToast } from '@/lib/toast';

/** One Stop at a time, with the toast every Stop gives (K4). Disabled until the work ends or the request fails. */
export function useStop(title: string, request: (() => Promise<void>) | undefined) {
  const [busy, setBusy] = useState(false);
  if (request == null) return null;
  const stop = () => {
    setBusy(true);
    request().then(
      () => mfToast.success(`Stopped “${title}”`),
      (error: unknown) => {
        setBusy(false);
        mfToast.error(`Could not stop “${title}”`, {
          description: error instanceof Error ? error.message : String(error),
        });
      },
    );
  };
  return { busy, stop };
}
