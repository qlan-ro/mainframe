/**
 * SessionListRouter — maps daemon WS chat events to sessions-list actions.
 *
 * chat.created / chat.ended (archive signal) / chat.updated → reload() re-runs
 *   adapter.list(). reload() is idempotent + dedups by chat id, so two-window
 *   ordering stays drift-free (spec §11). chat.updated reloads rather than
 *   surgically patching custom because @assistant-ui/react@0.14.14 exposes no
 *   mutate-one-thread API (D6 deviation — see plan Phase 7 header).
 * chat.notification / permission.requested / waiting-or-terminal chat.updated
 * → markUnread.
 * permission.resolved is a no-op: the subsequent chat.updated → reload re-carries
 *   displayStatus and clears the "waiting" badge (Spike 0.3 / S4). If 0.3 shows
 *   the daemon does NOT re-emit chat.updated, add `case 'permission.resolved':
 *   this.deps.onReload(); return;`.
 * background_task.started / .updated / .ended → reload. A background-only
 *   window (only a subagent running, no foreground turn) never emits
 *   chat.updated, so without this the sidebar badge freezes at idle even
 *   though the daemon's displayStatus is already "working" (D1).
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

function chatUpdatedNeedsAttention(event: Extract<DaemonEvent, { type: 'chat.updated' }>): boolean {
  return event.chat.displayStatus === 'waiting' || event.reason === 'completed' || event.reason === 'error';
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
        if (chatUpdatedNeedsAttention(event)) this.deps.onMarkUnread(event.chat.id);
        return;

      case 'chat.notification':
        this.deps.onMarkUnread(event.chatId);
        return;

      case 'permission.requested':
        this.deps.onMarkUnread(event.chatId);
        return;

      case 'background_task.started':
      case 'background_task.updated':
      case 'background_task.ended':
        this.deps.onReload();
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
