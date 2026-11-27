/**
 * Boot auto-select: open a session once the list first loads, so the app doesn't
 * land on the empty new-thread picker. Prefers the last session open before the
 * app closed (persisted by daemon chat id), falling back to the most-recent one
 * when it's gone or archived. One-shot — consumed on the first non-empty list —
 * and only while on the boot draft (mainThreadId null/`__LOCALID_*`), so it
 * never overrides a thread the user opened or a new chat they started sending.
 *
 * A create in flight for the draft means the user already chose it by sending.
 * On a fresh install the first non-empty list is the reload triggered by that
 * chat's own `chat.created`, which lands before the create workflow settles;
 * switching then reads as abandoning the draft and destroys the new chat.
 *
 * Boot also attaches the remembered chat before this runs (`boot-chat-prewarm`).
 * Whatever this decides, the prewarm is told so it can keep or drop its guess.
 */
import { useEffect, useRef } from 'react';
import type { useAui } from '@assistant-ui/react';
import { useLastSessionStore } from '../../../store/last-session';
import { settleBootPrewarm } from '../runtime/boot-chat-prewarm';
import { useSessionListLoadState } from '../runtime/list-load-state';
import { isCreateInFlight } from '../runtime/new-thread-coordinator';
import { isCarriedDraft } from '../new-thread/draft-carry';
import type { SessionItem } from '../view-model/chat-to-thread-custom';
import { pickInitialSession } from '../view-model/initial-session';

type Threads = ReturnType<typeof useAui>['threads'];

function listedChatIds(items: readonly SessionItem[]): Set<string> {
  const ids = new Set<string>();
  for (const item of items) if (item.status !== 'archived' && item.remoteId != null) ids.add(item.remoteId);
  return ids;
}

export function useBootAutoSelect(
  items: readonly SessionItem[],
  mainThreadId: string | null,
  threads: Threads,
  newThreadSwitchPending: boolean,
  listLoading: boolean,
): void {
  const didAutoSelectRef = useRef(false);
  useEffect(() => {
    if (didAutoSelectRef.current || items.length === 0) return;
    didAutoSelectRef.current = true;

    const opened = (id: string | null) => items.find((item) => item.id === id)?.remoteId ?? null;
    const onBootDraft = mainThreadId == null || mainThreadId.startsWith('__LOCALID_');
    // The one-shot is consumed above regardless — a New switch pending (todo
    // #375) means the user already chose it, same as isCreateInFlight.
    if (
      !onBootDraft ||
      newThreadSwitchPending ||
      isCarriedDraft(mainThreadId) ||
      (mainThreadId != null && isCreateInFlight(mainThreadId))
    ) {
      settleBootPrewarm(opened(mainThreadId), listedChatIds(items));
      return;
    }

    const target = pickInitialSession(items, useLastSessionStore.getState().lastSessionId);
    settleBootPrewarm(opened(target), listedChatIds(items));
    if (target != null && target !== mainThreadId) {
      threads.switchToThread(target);
    }
  }, [items, mainThreadId, threads, newThreadSwitchPending]);

  // No chats to open (first run, or the remembered one was the last and is gone), or the
  // list failed: the guess has nothing to hand over to. `loaded` latches inside the adapter,
  // a moment before the runtime publishes the items, so it takes the runtime's own
  // `isLoading` going false to say the list really is empty.
  const listLoaded = useSessionListLoadState((s) => s.loaded);
  const listFailed = useSessionListLoadState((s) => s.failed);
  useEffect(() => {
    if (listLoading || items.length > 0) return;
    if (listLoaded || listFailed) settleBootPrewarm(null, new Set());
  }, [listLoading, listLoaded, listFailed, items.length]);
}
