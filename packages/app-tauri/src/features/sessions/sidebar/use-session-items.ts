/**
 * threadsToSessionItems — maps native thread-list entries to our SessionItem VM.
 *
 * Each native thread carries our domain projection in `custom` (set by
 * chatToThreadCustom in the adapter). This is a pure transform so it can be
 * unit-tested without the aui runtime.
 */
import type { SessionItem, SessionCustom } from '../view-model/chat-to-thread-custom';

interface NativeThread {
  id: string;
  remoteId?: string;
  title?: string | null;
  status: string;
  custom: SessionCustom;
}

export function threadsToSessionItems(threads: readonly NativeThread[]): SessionItem[] {
  return threads.map((t) => ({
    id: t.id,
    remoteId: t.remoteId,
    title: t.title ?? undefined,
    status: t.status === 'archived' ? 'archived' : 'regular',
    custom: t.custom,
  }));
}
