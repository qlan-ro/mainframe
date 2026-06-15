/**
 * Busy-flag + toast-error wrapper for git branch actions.
 *
 * `withBusy` wraps an async fn: sets busy=true, runs the fn, catches and
 * toasts any thrown Error, then clears busy. Returns true on success, false
 * on error — callers use the boolean to decide whether to proceed.
 */
import { useCallback, useState } from 'react';
import { toast } from 'sonner';

export interface BranchBusy {
  busy: boolean;
  busyAction: string | null;
  withBusy: (fn: () => Promise<void>, action?: string) => Promise<boolean>;
}

export function useBranchBusy(): BranchBusy {
  const [busy, setBusy] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const withBusy = useCallback(async (fn: () => Promise<void>, action?: string): Promise<boolean> => {
    setBusy(true);
    setBusyAction(action ?? null);
    try {
      await fn();
      return true;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Git operation failed');
      return false;
    } finally {
      setBusy(false);
      setBusyAction(null);
    }
  }, []);

  return { busy, busyAction, withBusy };
}
