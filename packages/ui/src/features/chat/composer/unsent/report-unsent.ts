import { mfToast } from '@/lib/toast';
import { getUnsent, type UnsentMessage } from './unsent-store';

export const unsentTitle = (failure: NonNullable<UnsentMessage['failure']>) =>
  failure.delivery === 'unknown' ? 'Your message may not have been sent.' : 'Your message wasn’t sent.';

/** Says a first message failed, wherever the user is; the notice in its composer offers what to do. */
export function reportUnsent(id: string | undefined): void {
  const failure = getUnsent(id)?.failure;
  if (failure) mfToast.error(unsentTitle(failure), { description: failure.reason });
}
