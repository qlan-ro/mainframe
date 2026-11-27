import { useCallback, useRef, useSyncExternalStore } from 'react';
import { useAuiState, type ThreadMessage } from '@assistant-ui/react';
import type { AcpChatController } from '../controller/acp-chat-controller';
import { projectionInputs } from '../controller/project-messages';
import { TranscriptProjector } from '../controller/transcript-projector';
import { noSubscription, useAwayFromTail, useChatController } from './use-away-from-tail';

interface Projection {
  key: readonly unknown[];
  projected: readonly ThreadMessage[];
}
interface Entry {
  projector: TranscriptProjector;
  /** Readers away from the tail; the entry is dropped with the last of them. */
  readers: number;
  last?: Projection;
}
const projectors = new WeakMap<AcpChatController, Entry>();

function entryOf(controller: AcpChatController): Entry {
  let entry = projectors.get(controller);
  if (!entry) {
    entry = { projector: new TranscriptProjector(), readers: 0 };
    projectors.set(controller, entry);
  }
  return entry;
}

/** Subscribes to the controller as a reader of its live projection, which lives while one does. */
function subscribeReader(controller: AcpChatController, listener: () => void): () => void {
  const entry = entryOf(controller);
  entry.readers += 1;
  const off = controller.subscribeState(listener);
  return () => {
    off();
    entry.readers -= 1;
    // The last reader away: the projection and the projector's own memory of the window go with it.
    if (entry.readers === 0) projectors.delete(controller);
  };
}

/**
 * The controller's live transcript as thread messages, projected once per controller and per change
 * of what the projection reads, however many consumers read it (a streamed frame is projected once,
 * not per reader).
 */
function liveProjection(controller: AcpChatController): readonly ThreadMessage[] {
  const entry = entryOf(controller);
  const state = controller.getState();
  const key = projectionInputs(state);
  if (entry.last && entry.last.key.every((part, index) => Object.is(part, key[index]))) return entry.last.projected;
  const projected = entry.projector.projectMessages({ ...state, windowMessages: null }, state.messages);
  entry.last = { key, projected };
  return projected;
}

/**
 * An external-store read with a selector, re-rendering only when what the selector makes of the
 * snapshot changes. `select` may be a new function each render; the latest is the one used.
 */
function useSelected<S, T>(subscribe: (listener: () => void) => () => void, snapshot: () => S, select: (s: S) => T): T {
  const cache = useRef<{ snap: S; select: (s: S) => T; value: T } | null>(null);
  // A new `select` changes `read`, not the subscription, and is the one the next store check uses.
  const read = useCallback(() => {
    const snap = snapshot();
    const held = cache.current;
    // Same snapshot and same selector: same answer, so a store check costs no re-render.
    if (held && Object.is(held.snap, snap) && held.select === select) return held.value;
    const value = select(snap);
    cache.current = { snap, select, value };
    return value;
  }, [snapshot, select]);
  return useSyncExternalStore(subscribe, read);
}

/**
 * Something derived from the chat's live transcript. The thread's own messages are the live window
 * except while the reader is in a window around a jump target, when they are that window: the session
 * panel's Activity and the gate queue describe what the chat is doing, so they read the live window.
 *
 * Neither path re-renders a consumer whose answer is unchanged: at the tail `select` runs inside
 * the thread's own selector; away from the tail it runs over the controller's live messages
 * (projected once per frame for all consumers) through a cached selector read.
 */
export function useLiveMessages<T>(select: (messages: readonly ThreadMessage[]) => T): T {
  // Away from the tail the thread's messages are the jump window: not read, so its changes cost nothing here.
  const away = useAwayFromTail();
  const atTail = useAuiState((s) => (away ? undefined : select(s.thread.messages)));
  const controller = useChatController();
  const live = away && controller ? controller : undefined;
  const subscribe = useCallback(
    (listener: () => void) => (live ? subscribeReader(live, listener) : noSubscription()),
    [live],
  );
  const snapshot = useCallback(() => (live ? liveProjection(live) : undefined), [live]);
  const awayValue = useSelected(subscribe, snapshot, (messages) => (messages ? select(messages) : undefined));
  return live ? (awayValue as T) : (atTail as T);
}
