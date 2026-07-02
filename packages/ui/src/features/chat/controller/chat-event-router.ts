/**
 * Daemon-event routing — the controller's side-effect dispatch for a single
 * daemon event, extracted so the controller stays under the 300-line limit.
 *
 * Owns NO state. It mirrors live chat.updated into the composer config, surfaces
 * a failed queued-cancel, runs the pure `handleDaemonEvent` mapper, and on a
 * user `message.added` runs the count-aware optimistic reconcile. The host
 * (ChatThreadController) feeds it the chat id + the dispatch/refresh callbacks
 * and live reads of the reducer state (messagesById / pendingUserMessages).
 */
import type { DaemonEvent } from '@qlan-ro/mainframe-types';
import { mfToast } from '@/lib/toast';
import type { ChatStateEvent, ChatThreadState } from './chat-thread-state';
import { handleDaemonEvent } from './handle-daemon-event';
import { reconcilePendings } from './chat-reconcile';

export interface DaemonEventRouterHost {
  /** The daemon chat id at routing time (read lazily — it can flip via setRemoteId). */
  getChatId: () => string;
  /** Live read of the current reducer state (messagesById + pendingUserMessages). */
  getState: () => ChatThreadState;
  /** Apply a state event through the reducer. */
  dispatch: (event: ChatStateEvent) => void;
  /** Background refetch-on-gap when the mapper reports an unknown-id delta. */
  refreshInBackground: () => void;
}

export function routeDaemonEvent(event: DaemonEvent, host: DaemonEventRouterHost): void {
  // subscribe:ack is consumed by ChatWsSubscription before it reaches here, so
  // routing only sees real daemon events (ack-gating lives in the helper now).
  const chatId = host.getChatId();
  const state = host.getState();

  // Keep the composer config (model/plan/permission/effort/features) live:
  // mirror the daemon's chat metadata into state so the toolbar reflects
  // daemon-side changes (e.g. the agent exiting plan mode). This is additive —
  // handleDaemonEvent below still maps chat.updated → run.started/stopped.
  if (event.type === 'chat.updated' && event.chat.id === chatId) {
    host.dispatch({ type: 'chat.config.updated', chat: event.chat });
  }

  // A queued-message cancel the daemon couldn't honor leaves the message
  // queued — surface it (the reducer keeps state, so there's no other signal).
  if (event.type === 'message.queued.cancel_failed' && event.chatId === chatId) {
    mfToast.error("Couldn't cancel the queued message", {
      description: 'It will still be sent when the current run finishes.',
    });
  }

  // A daemon run error (e.g. the CLI process failed to start) otherwise only
  // flips runState to 'error' — silent to the user. Surface the message so the
  // reason is visible (chatId is optional: undefined = global/current run).
  if (event.type === 'error' && (event.chatId === undefined || event.chatId === chatId)) {
    const description = typeof event.error === 'string' ? event.error : undefined;
    mfToast.error('Agent run failed', description !== undefined ? { description } : undefined);
  }

  const result = handleDaemonEvent(event, chatId, state.messagesById);

  if (result.kind === 'refresh') {
    host.refreshInBackground();
    return;
  }

  if (result.kind === 'event') {
    // Optimistic reconcile: on display.message.added with user content,
    // try to match and remove the pending entry.
    if (result.event.type === 'message.added' && result.event.message.type === 'user') {
      for (const clientId of reconcilePendings(state.pendingUserMessages, [result.event.message])) {
        host.dispatch({ type: 'local.message.reconciled', clientId });
      }
    }

    // A live display.messages.set routes here as history.loaded — the added-path
    // reconcile above never sees it, so reconcile the optimistic pendings against
    // the user messages in the set too (count-aware), or the optimistic copy
    // lingers next to the server echo as a duplicate user bubble. This is NOT a
    // rare path: the daemon emits a full set whenever it can't detect a pure
    // append, and the Codex adapter regenerates every display id (nanoid) on each
    // reconstruction, so it re-sets on essentially every turn of a live session.
    if (result.event.type === 'history.loaded') {
      const userMessages = result.event.messages.filter((m) => m.type === 'user');
      for (const clientId of reconcilePendings(state.pendingUserMessages, userMessages)) {
        host.dispatch({ type: 'local.message.reconciled', clientId });
      }
    }

    host.dispatch(result.event);
  }
}
