/**
 * ChatWsSubscription — the controller's WS attachment, extracted so the
 * controller stays under the 300-line limit and the dormancy split (subscribe
 * the WS only when the thread is active) is a single composition point.
 *
 * Pure transport + resume/ack/restore timing; it owns NO reducer state. The
 * host (ChatThreadController) feeds it callbacks: route a daemon event, read
 * the "recently replied" / "held permission ids" sets for the restore-skip
 * checks, dispatch a restored permission, and refresh on reconnect.
 */
import type { ControlRequest, DaemonEvent } from '@qlan-ro/mainframe-types';
import type { DaemonWsClient } from '../../../lib/daemon/ws-client';
import { getPendingPermission, resumeChat } from '../../../lib/api/chats';

// How long to wait for subscribe:ack before falling back to an unconditional resume.
const SUBSCRIBE_ACK_TIMEOUT_MS = 2000;

export interface ChatWsHost {
  readonly chatId: string;
  readonly port: number;
  readonly ws: DaemonWsClient;
  /** Route a daemon event into the controller (it filters subscribe:ack itself first via onAck). */
  onEvent: (event: DaemonEvent) => void;
  /** Tool-use ids whose permission reply is still in flight — skip restoring them. */
  getRecentlyReplied: () => ReadonlySet<string>;
  /** requestIds the controller already holds — skip a duplicate restore. */
  getHeldPermissionIds: () => ReadonlySet<string>;
  /** Seed the gate from a REST-read pending permission. */
  dispatchPermission: (request: ControlRequest) => void;
  /** Background refetch-on-gap after a reconnect resume. */
  onReconnectRefresh: () => void;
  /** True once the controller is disposed — gates all async tails. */
  isDisposed: () => boolean;
}

export class ChatWsSubscription {
  private unsubscribeFromWs: (() => void) | null = null;
  private unsubscribeFromConn: (() => void) | null = null;
  private awaitingAck = false;
  private isReconnect = false;
  private ackFallbackTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly host: ChatWsHost) {}

  get attached(): boolean {
    return this.unsubscribeFromWs !== null;
  }

  attach(): void {
    if (this.unsubscribeFromWs) return;
    const { ws } = this.host;

    // Attach the event handler FIRST so the subscribe:ack frame is never missed.
    this.unsubscribeFromWs = ws.onEvent((event: DaemonEvent) => {
      if (this.host.isDisposed()) return;
      if (this.tryConsumeAck(event)) return;
      this.host.onEvent(event);
    });

    this.sendSubscribe(false);

    this.unsubscribeFromConn = ws.subscribeConnection(() => {
      if (this.host.isDisposed() || !ws.connected) return;
      this.sendSubscribe(true);
    });
  }

  detach(): void {
    this.clearAckFallback();
    this.awaitingAck = false;
    this.host.ws.unsubscribe(this.host.chatId);
    this.unsubscribeFromWs?.();
    this.unsubscribeFromWs = null;
    this.unsubscribeFromConn?.();
    this.unsubscribeFromConn = null;
  }

  /** Returns true if the event was a subscribe:ack for this chat (consumed here). */
  private tryConsumeAck(event: DaemonEvent): boolean {
    if (event.type !== 'subscribe:ack' || event.chatId !== this.host.chatId) return false;
    if (this.awaitingAck) {
      this.clearAckFallback();
      const wasReconnect = this.isReconnect;
      this.awaitingAck = false;
      this.handleSubscribeAck(wasReconnect);
    }
    return true;
  }

  private sendSubscribe(reconnect: boolean): void {
    this.clearAckFallback();
    this.awaitingAck = true;
    this.isReconnect = reconnect;
    this.host.ws.subscribe(this.host.chatId);

    this.ackFallbackTimer = setTimeout(() => {
      if (!this.awaitingAck || this.host.isDisposed()) return;
      // Socket down → the subscribe frame was dropped; stay armed, reconnect re-sends.
      if (!this.host.ws.connected) return;
      this.awaitingAck = false;
      console.warn('[chat-ws] subscribe:ack not received within timeout — resuming anyway');
      this.handleSubscribeAck(reconnect);
    }, SUBSCRIBE_ACK_TIMEOUT_MS);
  }

  private handleSubscribeAck(reconnect: boolean): void {
    void resumeChat(this.host.port, this.host.chatId).catch((err: unknown) =>
      console.warn('[chat-ws] resumeChat failed', err),
    );
    this.restorePendingPermission();
    if (reconnect) this.host.onReconnectRefresh();
  }

  private restorePendingPermission(): void {
    void getPendingPermission(this.host.port, this.host.chatId)
      .then((request) => {
        if (this.host.isDisposed() || !request) return;
        if (this.host.getRecentlyReplied().has(request.toolUseId)) return;
        if (request.requestId && this.host.getHeldPermissionIds().has(request.requestId)) return;
        this.host.dispatchPermission(request);
      })
      .catch((err: unknown) => console.warn('[chat-ws] restore pending-permission failed', err));
  }

  private clearAckFallback(): void {
    if (this.ackFallbackTimer !== null) {
      clearTimeout(this.ackFallbackTimer);
      this.ackFallbackTimer = null;
    }
  }
}
