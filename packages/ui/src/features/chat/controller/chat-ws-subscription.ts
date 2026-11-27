/**
 * ChatWsSubscription — the controller's SIDE-BAND WS attachment: config
 * broadcasts, background tasks, worktree offers, workflow runs. The chat
 * surface itself (transcript, run frames, gates, queue, usage, compaction,
 * clears) rides the ACP facade (`acp-session-plane.ts`), which owns its own
 * gap/resume convergence — so the ack-gated resume, the pending-permission
 * restore, and the reattach re-seed that used to live here are gone with
 * the mechanisms they served.
 *
 * What remains: subscribe on attach (the daemon replays the worktree-offer
 * snapshot to a new subscriber), re-subscribe on socket reconnect, and the
 * `POST /chats/:id/resume?waitFor=transcript&initialWindow=true` prepares
 * a validated tail or full transcript before attachment.
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
  private warm: Promise<void> = Promise.resolve();
  /** The last warm-up request failed, so the next open of the socket asks again. */
  private warmFailed = false;
  /** The socket was seen down since the last subscribe. */
  private sawDrop = false;

  constructor(private readonly host: ChatWsHost) {}

  async whenTranscriptReady(): Promise<void> {
    let current: Promise<void>;
    do {
      current = this.warm;
      await current;
    } while (current !== this.warm);
  }

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

    // A subscription made before the socket first opens needs nothing on that open: its frame is
    // buffered until then and the warm-up request has already gone out (boot attaches the
    // remembered chat that way). Subscribe again only after a drop, or if the warm-up failed.
    this.unsubscribeFromConn = ws.subscribeConnection(() => {
      if (this.host.isDisposed()) return;
      if (!ws.connected) {
        this.sawDrop = true;
        return;
      }
      if (this.sawDrop || this.warmFailed) this.subscribeAndWarm();
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
    this.sawDrop = false;
    this.warmFailed = false;
    this.host.ws.subscribe(this.host.chatId);
    this.warm = resumeChat(this.host.port, this.host.chatId, { waitFor: 'transcript', initialWindow: true }).catch(
      (err: unknown) => {
        this.warmFailed = true;
        console.warn('[chat-ws] resumeChat failed', err);
      },
    );
  }
}
