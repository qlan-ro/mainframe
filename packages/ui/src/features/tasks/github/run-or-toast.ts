/**
 * The sync store rethrows every mutation failure — publish, import, unlink —
 * because only the surface that fired one knows what to call it. This is that
 * surface's half of the contract.
 */
import { mfToast } from '@/lib/toast';

export async function runOrToast(failureTitle: string, action: () => Promise<void>): Promise<void> {
  try {
    await action();
  } catch (err) {
    mfToast.error(failureTitle, { description: err instanceof Error ? err.message : String(err) });
  }
}
