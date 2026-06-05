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
import type { DaemonEvent, ControlResponse, DisplayContent } from '@qlan-ro/mainframe-types';
import type { DaemonWsClient } from '../../../lib/daemon/ws-client';
import { getChatMessages, interruptChat, resumeChat } from '../../../lib/api/chats';
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
  if (!textBlock) return null;

  const serverFp = normalizeText(textBlock.text);
  const now = Date.now();

  const candidates = Object.values(state.pendingUserMessages).filter(
    (p): p is PendingUserMessage =>
      p.status === 'pending' &&
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

export class ChatThreadController {
  private state: ChatThreadState;
  private readonly listeners = new Set<() => void>();
  private unsubscribeFromWs: (() => void) | null = null;
  private unsubscribeFromConn: (() => void) | null = null;
  private loadPromise: Promise<void> | null = null;
  private disposed = false;

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

  public async sendMessage(message: AppendMessage): Promise<void> {
    if (message.role !== 'user') return;

    const textPart = message.content.find((p) => p.type === 'text');
    const text = textPart?.type === 'text' ? textPart.text.trim() : '';
    if (!text) return;

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
      this.ws.send({ type: 'message.send', chatId: this.chatId, content: text });
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

  // --------------------------------------------------------------------------
  // WS subscription
  // --------------------------------------------------------------------------

  private ensureWsSubscription(): void {
    if (this.unsubscribeFromWs) return;

    this.ws.subscribe(this.chatId);
    void resumeChat(this.port, this.chatId).catch((err: unknown) =>
      console.warn('[chat-controller] resumeChat failed', err),
    );

    this.unsubscribeFromWs = this.ws.onEvent((event: DaemonEvent) => {
      if (this.disposed) return;
      this.routeDaemonEvent(event);
    });

    this.unsubscribeFromConn = this.ws.subscribeConnection(() => {
      if (this.disposed || !this.ws.connected) return;
      this.ws.subscribe(this.chatId);
      void resumeChat(this.port, this.chatId).catch((err: unknown) =>
        console.warn('[chat-controller] reconnect resumeChat failed', err),
      );
      void this.refresh();
    });
  }

  private detachWs(): void {
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
