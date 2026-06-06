/**
 * Per-chat controller — mirrors react-opencode's `OpenCodeThreadController`.
 *
 * Lifecycle: created on chat open, disposed on chat switch.
 * Holds the pure ChatThreadState, subscribes to the shared DaemonWsClient,
 * seeds from REST on load() / reconnect, and dispatches reducer events.
 *
 * Daemon event routing is in handle-daemon-event.ts (pure function).
 * Reconciliation of optimistic pending messages happens on display.message.added.
 */
import type { AppendMessage } from '@assistant-ui/react';
import type { DaemonEvent, ControlResponse, DisplayContent, DisplayMessage } from '@qlan-ro/mainframe-types';
import type { DaemonWsClient } from '../../../lib/daemon/ws-client';
import {
  getChatMessages,
  getPendingPermission,
  interruptChat,
  resumeChat,
  cancelQueuedMessage,
  editQueuedMessage,
} from '../../../lib/api/chats';
import { uploadAttachments } from '../../../lib/api/attachments';
import { toUploadItems } from '../composer/attachment-adapter';
import {
  createChatThreadState,
  reduceChatThreadState,
  type ChatThreadState,
  type ChatStateEvent,
  type PendingUserMessage,
} from './chat-thread-state';
import { handleDaemonEvent } from './handle-daemon-event';

// ---------------------------------------------------------------------------
// Optimistic send helpers
// ---------------------------------------------------------------------------

let localIdCounter = 0;
function createLocalId(prefix: string): string {
  localIdCounter += 1;
  return `${prefix}_${Date.now().toString(36)}${localIdCounter.toString(36)}`;
}

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

// Sentinel key for attachment-only (no meaningful text) messages, so an empty
// server text can never wildcard-match a text-bearing pending.
const ATTACHMENT_KEY = '\0attachment';

function reconcileKey(text: string): string {
  const fp = normalizeText(text);
  return fp.length > 0 ? fp : ATTACHMENT_KEY;
}

function contentKey(content: DisplayContent[]): string {
  const textBlock = content.find((c): c is DisplayContent & { type: 'text' } => c.type === 'text');
  return reconcileKey(textBlock?.text ?? '');
}

/**
 * Match optimistic pendings against confirmed server user-messages by a
 * count-aware multiset, oldest pending first. The server is authoritative:
 * each server message reconciles AT MOST one pending, so N identical-text sends
 * need N server copies — no over-clear, no empty-text wildcard, no time window.
 * The single live `message.added` and the full history re-seed are the SAME
 * call (one message vs many). Returns the clientIds to reconcile.
 */
function reconcilePendings(
  pendings: Readonly<Record<string, PendingUserMessage>>,
  serverMessages: readonly { content: DisplayContent[] }[],
): string[] {
  const remaining = new Map<string, number>();
  for (const m of serverMessages) {
    const k = contentKey(m.content);
    remaining.set(k, (remaining.get(k) ?? 0) + 1);
  }
  const matched: string[] = [];
  const oldestFirst = Object.values(pendings)
    .filter((p): p is PendingUserMessage => p.status === 'pending')
    .sort((a, b) => a.createdAt - b.createdAt);
  for (const p of oldestFirst) {
    const k = reconcileKey(p.text);
    const n = remaining.get(k) ?? 0;
    if (n > 0) {
      remaining.set(k, n - 1);
      matched.push(p.clientId);
    }
  }
  return matched;
}

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

// How long to wait for subscribe:ack before falling back to an unconditional resume.
const SUBSCRIBE_ACK_TIMEOUT_MS = 2000;

// After answering a permission we optimistically drop the gate, but a WS send is
// dropped if the socket is closed. Re-check the daemon's pending after this delay;
// if the same tool use is still pending, the answer was lost — restore the gate.
const PERMISSION_VERIFY_DELAY_MS = 3000;

export class ChatThreadController {
  private state: ChatThreadState;
  private readonly listeners = new Set<() => void>();
  private unsubscribeFromWs: (() => void) | null = null;
  private unsubscribeFromConn: (() => void) | null = null;
  private loadPromise: Promise<void> | null = null;
  private disposed = false;
  // subscribe:ack gating (fix #3)
  private awaitingAck = false;
  private isReconnect = false;
  private ackFallbackTimer: ReturnType<typeof setTimeout> | null = null;
  // Permission-reply reliability: re-check delivery (#2) and suppress restoring a
  // just-answered permission while the reply is still in flight (#5).
  private readonly permissionVerifyTimers = new Set<ReturnType<typeof setTimeout>>();
  private readonly recentlyRepliedToolUseIds = new Set<string>();

  constructor(
    private readonly chatId: string,
    private readonly port: number,
    private readonly ws: DaemonWsClient,
  ) {
    this.state = createChatThreadState(chatId);
  }

  // --------------------------------------------------------------------------
  // useSyncExternalStore interface
  // --------------------------------------------------------------------------

  public getState(): ChatThreadState {
    return this.state;
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    this.ensureWsSubscription();
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) this.detachWs();
    };
  }

  // --------------------------------------------------------------------------
  // Lifecycle
  // --------------------------------------------------------------------------

  public dispose(): void {
    this.disposed = true;
    this.detachWs();
    this.listeners.clear();
    this.clearAckFallback();
    for (const timer of this.permissionVerifyTimers) clearTimeout(timer);
    this.permissionVerifyTimers.clear();
    this.recentlyRepliedToolUseIds.clear();
  }

  // --------------------------------------------------------------------------
  // Actions
  // --------------------------------------------------------------------------

  public async load(force = false): Promise<void> {
    if (this.loadPromise && !force) return this.loadPromise;

    this.dispatch({ type: 'history.loading' });

    const request = getChatMessages(this.port, this.chatId)
      .then((messages) => {
        if (this.loadPromise !== request) return;
        this.dispatch({ type: 'history.loaded', messages });
        this.reconcilePendingAgainstHistory(messages);
      })
      .catch((error: unknown) => {
        if (this.loadPromise !== request) return;
        this.dispatch({ type: 'history.failed', error });
      })
      .finally(() => {
        if (this.loadPromise === request) this.loadPromise = null;
      });

    this.loadPromise = request;
    return request;
  }

  public refresh(): Promise<void> {
    return this.load(true);
  }

  /**
   * Reconcile optimistic pendings against re-seeded history. A reconnect/refetch
   * delivers the server echo via `history.loaded`, NOT `message.added`, so the
   * live reconcile path never fires — without this the optimistic copy lingers
   * as a duplicate. The full user-message list is fed to the same count-aware
   * matcher the live path uses, so it is authoritative and count-correct.
   */
  private reconcilePendingAgainstHistory(messages: DisplayMessage[]): void {
    const userMessages = messages.filter((m) => m.type === 'user');
    for (const clientId of reconcilePendings(this.state.pendingUserMessages, userMessages)) {
      this.dispatch({ type: 'local.message.reconciled', clientId });
    }
  }

  public async sendMessage(message: AppendMessage): Promise<void> {
    if (message.role !== 'user') return;

    const textPart = message.content.find((p) => p.type === 'text');
    const text = textPart?.type === 'text' ? textPart.text.trim() : '';
    const uploadItems = toUploadItems(message.attachments);
    if (!text && uploadItems.length === 0) return;

    const pending: PendingUserMessage = {
      clientId: createLocalId('local'),
      chatId: this.chatId,
      text,
      createdAt: Date.now(),
      status: 'pending',
    };

    this.dispatch({ type: 'local.message.queued', pending });
    this.dispatch({ type: 'run.started' });

    try {
      // Upload attachments first → reference them by id (the daemon stores the bytes).
      const attachmentIds =
        uploadItems.length > 0 ? await uploadAttachments(this.port, this.chatId, uploadItems) : undefined;
      this.ws.send({
        type: 'message.send',
        chatId: this.chatId,
        content: text,
        ...(attachmentIds && attachmentIds.length > 0 ? { attachmentIds } : {}),
      });
    } catch (error) {
      this.dispatch({ type: 'local.message.failed', clientId: pending.clientId, error });
      throw error;
    }
  }

  public async cancel(): Promise<void> {
    this.dispatch({ type: 'run.cancelling' });
    try {
      await interruptChat(this.port, this.chatId);
    } catch (error) {
      this.dispatch({ type: 'run.failed', error });
      throw error;
    }
  }

  public async replyToPermission(requestId: string, response: ControlResponse): Promise<void> {
    // Optimistically drop the gate, but remember we answered this tool use so a
    // racing restore (subscribe/reconnect REST read of the not-yet-cleared
    // pending) doesn't resurrect it, and verify the answer actually landed.
    this.recentlyRepliedToolUseIds.add(response.toolUseId);
    this.ws.send({ type: 'permission.respond', chatId: this.chatId, response });
    this.dispatch({ type: 'permission.resolved', requestId });
    this.verifyPermissionDelivered(response.toolUseId);
  }

  /**
   * 3s after answering, re-read the daemon's pending permission. If the SAME
   * tool use is still pending, our `permission.respond` was dropped (socket was
   * closed) — restore the gate so the user can retry. Either way the tool use
   * leaves the in-flight set so a genuine later pending can surface again.
   */
  private verifyPermissionDelivered(toolUseId: string): void {
    const timer = setTimeout(() => {
      this.permissionVerifyTimers.delete(timer);
      if (this.disposed) return;
      void getPendingPermission(this.port, this.chatId)
        .then((request) => {
          this.recentlyRepliedToolUseIds.delete(toolUseId);
          if (this.disposed || !request || request.toolUseId !== toolUseId) return;
          if (request.requestId && request.requestId in this.state.interactions.permissions) return;
          this.dispatch({ type: 'permission.requested', requestId: request.requestId, request });
        })
        .catch((err: unknown) => {
          this.recentlyRepliedToolUseIds.delete(toolUseId);
          console.warn('[chat-controller] verify permission delivery failed', err);
        });
    }, PERMISSION_VERIFY_DELAY_MS);
    this.permissionVerifyTimers.add(timer);
  }

  public async cancelQueued(messageId: string): Promise<void> {
    await cancelQueuedMessage(this.port, this.chatId, messageId);
  }

  public async editQueued(messageId: string, content: string): Promise<void> {
    await editQueuedMessage(this.port, this.chatId, messageId, content);
  }

  // --------------------------------------------------------------------------
  // WS subscription
  // --------------------------------------------------------------------------

  private ensureWsSubscription(): void {
    if (this.unsubscribeFromWs) return;

    // Attach the event handler FIRST so the subscribe:ack frame is never missed.
    this.unsubscribeFromWs = this.ws.onEvent((event: DaemonEvent) => {
      if (this.disposed) return;
      this.routeDaemonEvent(event);
    });

    this.sendSubscribe(false /* initial, not a reconnect */);

    this.unsubscribeFromConn = this.ws.subscribeConnection(() => {
      if (this.disposed || !this.ws.connected) return;
      this.sendSubscribe(true /* reconnect */);
    });
  }

  /**
   * Sends `subscribe` to the daemon and arms the ack-fallback timer.
   * resumeChat / refresh are called by `handleSubscribeAck` when the daemon
   * confirms the subscription.  If the ack never arrives (older daemon or lost
   * frame), the fallback timer fires after SUBSCRIBE_ACK_TIMEOUT_MS.
   */
  private sendSubscribe(reconnect: boolean): void {
    this.clearAckFallback();
    this.awaitingAck = true;
    this.isReconnect = reconnect;
    this.ws.subscribe(this.chatId);

    this.ackFallbackTimer = setTimeout(() => {
      if (!this.awaitingAck || this.disposed) return;
      // If the socket is down, the `subscribe` frame was dropped — resuming now
      // would talk to a dead subscription. Stay armed; the reconnect handler
      // re-sends `subscribe` (and re-arms this timer) once the socket reopens.
      if (!this.ws.connected) return;
      this.awaitingAck = false;
      console.warn('[chat-controller] subscribe:ack not received within timeout — resuming anyway');
      this.handleSubscribeAck(reconnect);
    }, SUBSCRIBE_ACK_TIMEOUT_MS);
  }

  /** Called when subscribe:ack arrives OR when the fallback fires. */
  private handleSubscribeAck(reconnect: boolean): void {
    void resumeChat(this.port, this.chatId).catch((err: unknown) =>
      console.warn('[chat-controller] resumeChat failed', err),
    );
    // The daemon does NOT re-emit `permission.requested` on subscribe/resume, so
    // a permission requested before this client loaded (or during a disconnect)
    // must be restored via REST — otherwise the gate never appears.
    this.restorePendingPermission();
    if (reconnect) {
      this.refreshInBackground();
    }
  }

  /** Fetch the chat's pending permission (if any) and seed the gate. */
  private restorePendingPermission(): void {
    void getPendingPermission(this.port, this.chatId)
      .then((request) => {
        if (this.disposed || !request) return;
        // Don't resurrect a permission we just answered — its reply may still be
        // in flight and the daemon may not have cleared the pending yet.
        // verifyPermissionDelivered owns the "was it actually delivered?" check.
        if (this.recentlyRepliedToolUseIds.has(request.toolUseId)) return;
        // Skip if we already hold this one (a live event beat the REST read).
        if (request.requestId && request.requestId in this.state.interactions.permissions) return;
        this.dispatch({ type: 'permission.requested', requestId: request.requestId, request });
      })
      .catch((err: unknown) => console.warn('[chat-controller] restore pending-permission failed', err));
  }

  private clearAckFallback(): void {
    if (this.ackFallbackTimer !== null) {
      clearTimeout(this.ackFallbackTimer);
      this.ackFallbackTimer = null;
    }
  }

  private detachWs(): void {
    this.clearAckFallback();
    this.awaitingAck = false;
    this.ws.unsubscribe(this.chatId);
    this.unsubscribeFromWs?.();
    this.unsubscribeFromWs = null;
    this.unsubscribeFromConn?.();
    this.unsubscribeFromConn = null;
  }

  // --------------------------------------------------------------------------
  // Event routing
  // --------------------------------------------------------------------------

  private routeDaemonEvent(event: DaemonEvent): void {
    // Intercept subscribe:ack before it reaches the generic handler so we can
    // gate resumeChat on the daemon's confirmation that the subscription is live.
    if (event.type === 'subscribe:ack' && event.chatId === this.chatId) {
      if (this.awaitingAck) {
        this.clearAckFallback();
        const wasReconnect = this.isReconnect;
        this.awaitingAck = false;
        this.handleSubscribeAck(wasReconnect);
      }
      return; // do not pass ack through to handleDaemonEvent
    }

    // Keep the composer config (model/plan/permission/effort/features) live:
    // mirror the daemon's chat metadata into state so the toolbar reflects
    // daemon-side changes (e.g. the agent exiting plan mode). This is additive —
    // handleDaemonEvent below still maps chat.updated → run.started/stopped.
    if (event.type === 'chat.updated' && event.chat.id === this.chatId) {
      this.dispatch({ type: 'chat.config.updated', chat: event.chat });
    }

    const result = handleDaemonEvent(event, this.chatId, this.state.messagesById);

    if (result.kind === 'refresh') {
      this.refreshInBackground();
      return;
    }

    if (result.kind === 'event') {
      // Optimistic reconcile: on display.message.added with user content,
      // try to match and remove the pending entry.
      if (result.event.type === 'message.added' && result.event.message.type === 'user') {
        for (const clientId of reconcilePendings(this.state.pendingUserMessages, [result.event.message])) {
          this.dispatch({ type: 'local.message.reconciled', clientId });
        }
      }

      this.dispatch(result.event);
    }
  }

  private refreshInBackground(): void {
    void this.refresh().catch((error: unknown) => console.warn('[chat-controller] refetch-on-gap failed', error));
  }

  private dispatch(event: ChatStateEvent): void {
    const nextState = reduceChatThreadState(this.state, event);
    if (nextState === this.state) return;
    this.state = nextState;
    for (const listener of this.listeners) listener();
  }
}
