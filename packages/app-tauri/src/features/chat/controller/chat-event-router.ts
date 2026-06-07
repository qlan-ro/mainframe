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
import { toast } from 'sonner';
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
    toast.error("Couldn't cancel the queued message", {
      description: 'It will still be sent when the current run finishes.',
    });
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

    host.dispatch(result.event);
  }
}
