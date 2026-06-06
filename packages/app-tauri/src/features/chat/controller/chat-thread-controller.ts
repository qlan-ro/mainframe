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

const PENDING_MATCH_WINDOW_MS = 2 * 60 * 1000;

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

function reconcilePendingOnAdd(state: ChatThreadState, content: DisplayContent[]): string | null {
  const textBlock = content.find((c): c is DisplayContent & { type: 'text' } => c.type === 'text');
  const now = Date.now();

  if (!textBlock) {
    // Attachment-only server message: match the oldest pending whose text is
    // empty (i.e. also attachment-only). Never reconcile a text-bearing pending
    // against a no-text server message.
    const candidates = Object.values(state.pendingUserMessages).filter(
      (p): p is PendingUserMessage =>
        p.status === 'pending' && p.text === '' && Math.abs(now - p.createdAt) <= PENDING_MATCH_WINDOW_MS,
    );
    if (candidates.length === 0) return null;
    const match = candidates.sort((a, b) => a.createdAt - b.createdAt)[0]!;
    return match.clientId;
  }

  const serverFp = normalizeText(textBlock.text);

  const candidates = Object.values(state.pendingUserMessages).filter(
    (p): p is PendingUserMessage =>
      p.status === 'pending' &&
      p.text !== '' &&
      Math.abs(now - p.createdAt) <= PENDING_MATCH_WINDOW_MS &&
      (serverFp.length === 0 || normalizeText(p.text) === serverFp),
  );

  if (candidates.length === 0) return null;
  const match = candidates.sort((a, b) => a.createdAt - b.createdAt)[0]!;
  return match.clientId;
}

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

// How long to wait for subscribe:ack before falling back to an unconditional resume.
const SUBSCRIBE_ACK_TIMEOUT_MS = 2000;

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
   * as a duplicate. Matches by text within the pending window (same rule as the
   * live path), and removes each matched pending.
   */
  private reconcilePendingAgainstHistory(messages: DisplayMessage[]): void {
    for (const message of messages) {
      if (message.type !== 'user') continue;
      const clientId = reconcilePendingOnAdd(this.state, message.content);
      if (clientId) this.dispatch({ type: 'local.message.reconciled', clientId });
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
    this.ws.send({ type: 'permission.respond', chatId: this.chatId, response });
    this.dispatch({ type: 'permission.resolved', requestId });
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
        const clientId = reconcilePendingOnAdd(this.state, result.event.message.content);
        if (clientId) {
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
