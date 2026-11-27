import { useMemo, useSyncExternalStore } from 'react';
import { useAuiState, type ThreadMessage } from '@assistant-ui/react';
import { TranscriptProjector } from '../controller/transcript-projector';
import { noSubscription, useAwayFromTail, useChatController } from './use-away-from-tail';

/**
 * Something derived from the chat's live transcript. The thread's own messages are the live window
 * except while the reader is in a window around a jump target, when they are that window: the session
 * panel's Activity and the gate queue describe what the chat is doing, so they read the live window.
 *
 * `select` runs at the tail inside the thread's own selector, so a consumer whose answer is stable
 * does not re-render per streamed delta. Away from the tail it runs over the controller's live
 * messages, normalised as the thread's are, and only then are they subscribed to.
 */
export function useLiveMessages<T>(select: (messages: readonly ThreadMessage[]) => T): T {
  const atTail = useAuiState((s) => select(s.thread.messages));
  const away = useAwayFromTail();
  const controller = useChatController();
  const live = useSyncExternalStore(
    away && controller ? (listener) => controller.subscribeState(listener) : noSubscription,
    () => (away ? controller?.getState().messages : undefined),
  );
  const projector = useMemo(() => new TranscriptProjector(), []);
  const awayValue = useMemo(() => {
    if (!away || !controller || !live) return undefined;
    return { value: select(projector.projectMessages({ ...controller.getState(), windowMessages: null }, live)) };
  }, [away, controller, live, projector, select]);
  return awayValue ? awayValue.value : atTail;
}
