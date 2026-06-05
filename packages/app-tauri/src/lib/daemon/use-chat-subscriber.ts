/**
 * useChatSubscriber — per-chat, snapshot-authoritative WS subscriber.
 *
 * Design (ADR 2026-06-05-chat-runtime-decision.md):
 *  - Created on chat open, TORN DOWN on chat switch (no persistent message cache).
 *  - Initial messages are seeded via REST GET `/api/chats/:id/messages` on subscribe
 *    and on reconnect — NOT from the WS `subscribe:ack` (which carries no payload).
 *  - `display.messages.set` is a mid-turn full-replace event; it is NOT the subscribe ack.
 *  - Applies `display.message.added/updated` in-order deltas during a turn.
 *  - On reconnect, re-subscribes and re-seeds from REST (full snapshot wins).
 *  - No Zustand. No global message store. Snapshot lives only in this hook's closure.
 *
 * Phase 1 note: There is NO monotonic version/sequence in the daemon events.
 * The `display.messages.set` arrives as a full replacement with no version stamp.
 * Stale-delta-after-set protection relies on the chatId epoch guard in this hook.
 * Phase 2 adds daemon-side versioning.
 */
import { useRef, useCallback, useEffect } from 'react';
import { useSyncExternalStore } from 'react';
import type { DisplayMessage } from '@qlan-ro/mainframe-types';
import type { DaemonEvent } from '@qlan-ro/mainframe-types';
import { daemonWs } from './ws-client';
import { getChatMessages, resumeChat } from '../api/chats';

export interface ChatSnapshot {
  messages: DisplayMessage[];
  isRunning: boolean;
  isLoading: boolean;
}

const EMPTY_SNAPSHOT: ChatSnapshot = {
  messages: [],
  isRunning: false,
  isLoading: true,
};

/**
 * Per-chat subscriber.
 *
 * Returns a stable `{ messages, isRunning, isLoading }` snapshot via
 * `useSyncExternalStore`. The snapshot is replaced wholesale on each
 * authoritative update — no mutation in place.
 *
 * The hook disposes everything when `chatId` changes or the component
 * unmounts: WS unsubscribe + event listener removal + any pending timers.
 */
export function useChatSubscriber(chatId: string, daemonPort: number | null): ChatSnapshot {
  // `snapshotRef` is the external store; `listenersRef` is the subscriber set.
  const snapshotRef = useRef<ChatSnapshot>(EMPTY_SNAPSHOT);
  const listenersRef = useRef<Set<() => void>>(new Set());
  // A counter that increments each time chatId changes, so stale async
  // callbacks from the previous chatId can detect they're outdated.
  const epochRef = useRef<number>(0);

  // Called by useSyncExternalStore in the renderer — must be stable reference.
  const getSnapshot = useCallback((): ChatSnapshot => {
    return snapshotRef.current;
  }, []);

  const subscribe = useCallback((onStoreChange: () => void): (() => void) => {
    listenersRef.current.add(onStoreChange);
    return () => listenersRef.current.delete(onStoreChange);
  }, []);

  // Notify all registered useSyncExternalStore listeners.
  const notify = (): void => {
    listenersRef.current.forEach((fn) => fn());
  };

  const setSnapshot = (next: ChatSnapshot): void => {
    snapshotRef.current = next;
    notify();
  };

  useEffect(() => {
    if (!daemonPort) return;

    // Reset snapshot for the new chat — subscribers will see isLoading=true
    // immediately, then a full set from the daemon clears it.
    epochRef.current += 1;
    const myEpoch = epochRef.current;
    snapshotRef.current = EMPTY_SNAPSHOT;
    notify();

    // Seed from REST GET so we have something to render before the WS fires.
    void getChatMessages(daemonPort, chatId)
      .then((msgs) => {
        if (epochRef.current !== myEpoch) return; // stale — chatId changed
        setSnapshot({ messages: msgs, isRunning: false, isLoading: false });
      })
      .catch((err) => {
        if (epochRef.current !== myEpoch) return;
        console.warn('[chat-subscriber] initial message fetch failed', err);
        setSnapshot({ messages: [], isRunning: false, isLoading: false });
      });

    // Subscribe over WS. The daemon responds with `subscribe:ack` (no payload).
    // Message data comes from the REST GET above; `display.messages.set` arrives
    // mid-turn as a full-replace, not as part of the subscribe handshake.
    daemonWs.subscribe(chatId);
    void resumeChat(daemonPort, chatId).catch((err) => {
      console.warn('[chat-subscriber] resumeChat failed', err);
    });

    // Route events for this chatId only.
    const unlistenWs = daemonWs.onEvent((event: DaemonEvent) => {
      if (epochRef.current !== myEpoch) return;

      switch (event.type) {
        case 'display.messages.set':
          if (event.chatId !== chatId) break;
          // Full authoritative snapshot — wins over any in-flight state.
          setSnapshot({
            messages: event.messages,
            isRunning: snapshotRef.current.isRunning,
            isLoading: false,
          });
          break;

        case 'display.message.added':
          if (event.chatId !== chatId) break;
          setSnapshot({
            ...snapshotRef.current,
            messages: [...snapshotRef.current.messages, event.message],
          });
          break;

        case 'display.message.updated':
          if (event.chatId !== chatId) break;
          setSnapshot({
            ...snapshotRef.current,
            messages: snapshotRef.current.messages.map((m) => (m.id === event.message.id ? event.message : m)),
          });
          break;

        case 'messages.cleared':
          if (event.chatId !== chatId) break;
          setSnapshot({ ...snapshotRef.current, messages: [], isLoading: false });
          break;

        case 'chat.updated':
          if (event.chat.id !== chatId) break;
          setSnapshot({
            ...snapshotRef.current,
            isRunning: event.chat.isRunning ?? snapshotRef.current.isRunning,
          });
          break;

        case 'process.started':
          if (event.chatId !== chatId) break;
          setSnapshot({ ...snapshotRef.current, isRunning: true });
          break;

        // process.stopped carries only processId, not chatId — there is no safe
        // way to scope it to this chat. isRunning=false is handled by chat.updated
        // (which is chatId-scoped) once the daemon updates the chat record.

        default:
          break;
      }
    });

    // On WS reconnect, re-subscribe and re-seed from REST (full snapshot wins).
    const unlistenConn = daemonWs.subscribeConnection(() => {
      if (!daemonWs.connected || epochRef.current !== myEpoch) return;
      daemonWs.subscribe(chatId);
      void resumeChat(daemonPort, chatId).catch((err) =>
        console.warn('[chat-subscriber] reconnect resumeChat failed', err),
      );
      setSnapshot({ ...snapshotRef.current, isLoading: true });
      void getChatMessages(daemonPort, chatId)
        .then((msgs) => {
          if (epochRef.current !== myEpoch) return;
          setSnapshot({ messages: msgs, isRunning: false, isLoading: false });
        })
        .catch((err) => {
          if (epochRef.current !== myEpoch) return;
          console.warn('[chat-subscriber] reconnect fetch failed', err);
          setSnapshot({ ...snapshotRef.current, isLoading: false });
        });
    });

    return () => {
      // Dispose: unsubscribe WS, remove listeners. Snapshot dies with this hook instance.
      daemonWs.unsubscribe(chatId);
      unlistenWs();
      unlistenConn();
    };
  }, [chatId, daemonPort]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
