/**
 * ChatWsSubscription — the controller's SIDE-BAND WS attachment (legacy
 * dialect): config broadcasts, queued refs, background tasks, worktree
 * offers, workflow runs, context usage, compaction markers. The transcript,
 * run frames, and gates arrive over the ACP facade (`acp-session-plane.ts`),
 * which owns its own gap/resume convergence — so the ack-gated resume, the
 * pending-permission restore, and the reattach re-seed that used to live
 * here are gone with the mechanisms they served.
 *
 * What remains: subscribe on attach (the daemon replays queued/worktree
 * snapshots to a new subscriber), re-subscribe on socket reconnect, and the
 * `POST /chats/:id/resume` warm-up that keeps the CLI process lifecycle
 * behavior of the legacy attach path.
 */
import type { DaemonEvent } from '@qlan-ro/mainframe-types';
import type { DaemonWsClient } from '../../../lib/daemon/ws-client';
import { resumeChat } from '../../../lib/api/chats';

export interface ChatWsHost {
  readonly chatId: string;
  readonly port: number;
  readonly ws: DaemonWsClient;
  /** Route a side-band daemon event into the controller. */
  onEvent: (event: DaemonEvent) => void;
  /** True once the controller is disposed — gates all async tails. */
  isDisposed: () => boolean;
}

export class ChatWsSubscription {
  private unsubscribeFromWs: (() => void) | null = null;
  private unsubscribeFromConn: (() => void) | null = null;

  constructor(private readonly host: ChatWsHost) {}

  attach(): void {
    if (this.unsubscribeFromWs) return;
    const { ws } = this.host;

    this.unsubscribeFromWs = ws.onEvent((event: DaemonEvent) => {
      if (this.host.isDisposed()) return;
      // The ack itself carries nothing the side-band consumes.
      if (event.type === 'subscribe:ack' && event.chatId === this.host.chatId) return;
      this.host.onEvent(event);
    });

    this.subscribeAndWarm();

    this.unsubscribeFromConn = ws.subscribeConnection(() => {
      if (this.host.isDisposed() || !ws.connected) return;
      this.subscribeAndWarm();
    });
  }

  detach(): void {
    this.host.ws.unsubscribe(this.host.chatId);
    this.unsubscribeFromWs?.();
    this.unsubscribeFromWs = null;
    this.unsubscribeFromConn?.();
    this.unsubscribeFromConn = null;
  }

  private subscribeAndWarm(): void {
    this.host.ws.subscribe(this.host.chatId);
    void resumeChat(this.host.port, this.host.chatId).catch((err: unknown) =>
      console.warn('[chat-ws] resumeChat failed', err),
    );
  }
}
