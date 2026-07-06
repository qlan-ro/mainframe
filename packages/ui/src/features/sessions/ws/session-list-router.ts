/**
 * SessionListRouter — maps daemon WS chat events to sessions-list actions.
 *
 * chat.created / chat.ended (archive signal) / chat.updated → reload() re-runs
 *   adapter.list(). reload() is idempotent + dedups by chat id, so two-window
 *   ordering stays drift-free (spec §11). chat.updated reloads rather than
 *   surgically patching custom because @assistant-ui/react@0.14.14 exposes no
 *   mutate-one-thread API (D6 deviation — see plan Phase 7 header).
 * chat.notification / permission.requested (notify:true) → markUnread.
 * permission.resolved is a no-op: the subsequent chat.updated → reload re-carries
 *   displayStatus and clears the "waiting" badge (Spike 0.3 / S4). If 0.3 shows
 *   the daemon does NOT re-emit chat.updated, add `case 'permission.resolved':
 *   this.deps.onReload(); return;`.
 *
 * The class is dependency-injected (onReload / onChatUpdated / onMarkUnread) so
 * it is testable with no React or zustand. useSessionListRouter (a sibling hook)
 * wires it to the live runtime, unread store, and daemon WS — call it once under
 * <AssistantRuntimeProvider>.
 */
import type { Chat, DaemonEvent } from '@qlan-ro/mainframe-types';
import type { DaemonWsClient } from '../../../lib/daemon/ws-client';

export interface SessionListRouterDeps {
  onReload: () => void;
  onMarkUnread: (chatId: string) => void;
  /**
   * chat.updated handler. Optional; when omitted, chat.updated falls back to
   * onReload (the corrected contract still reloads — see the D6 deviation).
   */
  onChatUpdated?: (chat: Chat) => void;
}

export interface SessionListRouterHandle {
  dispose: () => void;
}

export class SessionListRouter {
  private readonly unsubscribe: () => void;
  private disposed = false;

  constructor(
    ws: DaemonWsClient,
    private readonly deps: SessionListRouterDeps,
  ) {
    this.unsubscribe = ws.onEvent((event: DaemonEvent) => this.route(event));
  }

  private route(event: DaemonEvent): void {
    if (this.disposed) return;
    switch (event.type) {
      case 'chat.created':
      case 'chat.ended':
        this.deps.onReload();
        return;

      case 'chat.updated':
        if (this.deps.onChatUpdated) {
          this.deps.onChatUpdated(event.chat);
        } else {
          this.deps.onReload();
        }
        return;

      case 'chat.notification':
        this.deps.onMarkUnread(event.chatId);
        return;

      case 'permission.requested':
        if (event.notify) this.deps.onMarkUnread(event.chatId);
        return;

      default:
        return;
    }
  }

  dispose(): void {
    this.disposed = true;
    this.unsubscribe();
  }
}

/**
 * Construct a SessionListRouter wired to a daemon WS client. Returns a small
 * handle ({ dispose }) so the React glue (useSessionListRouter) can tear it down
 * on unmount without depending on the concrete class shape.
 */
export function createSessionListRouter(ws: DaemonWsClient, deps: SessionListRouterDeps): SessionListRouterHandle {
  return new SessionListRouter(ws, deps);
}
