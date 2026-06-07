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
 * The class is dependency-injected (onReload / onMarkUnread) so it is testable
 * with no React or zustand. useSessionListRouter wires it to the live runtime,
 * unread store, and daemon WS — call it once under <AssistantRuntimeProvider>.
 */
import { useEffect } from 'react';
import { useAssistantRuntime } from '@assistant-ui/react';
import type { DaemonEvent } from '@qlan-ro/mainframe-types';
import type { DaemonWsClient } from '../../../lib/daemon/ws-client';
import { daemonWs } from '../../../lib/daemon/ws-client';
import { useUnreadStore } from '../../../store/unread-store';

export interface SessionListRouterDeps {
  onReload: () => void;
  onMarkUnread: (chatId: string) => void;
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
      case 'chat.updated':
        this.deps.onReload();
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
 * Wire a SessionListRouter to the live thread-list runtime, unread store, and
 * the shared daemon WS. Mount ONCE under <AssistantRuntimeProvider> (Phase 8).
 */
export function useSessionListRouter(): void {
  const assistantRuntime = useAssistantRuntime();
  const markUnread = useUnreadStore((s) => s.markUnread);

  useEffect(() => {
    const router = new SessionListRouter(daemonWs, {
      onReload: () => {
        void assistantRuntime.threads.reload();
      },
      onMarkUnread: (chatId) => markUnread(chatId),
    });
    return () => router.dispose();
  }, [assistantRuntime, markUnread]);
}
