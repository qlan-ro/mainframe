/**
 * Per-chat controller — mirrors react-opencode's `OpenCodeThreadController`.
 *
 * Created once per thread id in the global registry and kept warm across
 * switches. `subscribeState` always feeds the UI from in-memory state;
 * `subscribeLive` opens the WS sub only while the thread is active. A new
 * (`__LOCALID_*`) thread adopts its daemon id via `setRemoteId` once createChat
 * resolves.
 *
 * Daemon event routing is in handle-daemon-event.ts (pure function).
 * Reconciliation of optimistic pending messages happens on display.message.added.
 */
import type { AppendMessage } from '@assistant-ui/react';
import type { DaemonEvent, ControlResponse, DisplayContent, DisplayMessage } from '@qlan-ro/mainframe-types';
import type { DaemonWsClient } from '../../../lib/daemon/ws-client';
import {
  getChat,
  getChatMessages,
  getPendingPermission,
  interruptChat,
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
import { ChatWsSubscription, type ChatWsHost } from './chat-ws-subscription';
import { toast } from 'sonner';

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

// After answering a permission we optimistically drop the gate, but a WS send is
// dropped if the socket is closed. Re-check the daemon's pending after this delay;
// if the same tool use is still pending, the answer was lost — restore the gate.
const PERMISSION_VERIFY_DELAY_MS = 3000;

export class ChatThreadController {
  private state: ChatThreadState;
  private readonly listeners = new Set<() => void>();
  private loadPromise: Promise<void> | null = null;
  private disposed = false;
  // Permission-reply reliability: re-check delivery (#2) and suppress restoring a
  // just-answered permission while the reply is still in flight (#5).
  private readonly permissionVerifyTimers = new Set<ReturnType<typeof setTimeout>>();
  private readonly recentlyRepliedToolUseIds = new Set<string>();
  // The id used for all network ops. Equals the daemon chat id for pre-existing
  // threads; for a new (__LOCALID_*) thread it starts local and is replaced by
  // setRemoteId() once the daemon chat is created. The WS sub never opens while
  // this is still a __LOCALID_*.
  private daemonId: string;
  private remoteIdSet = false;
  private liveRefs = 0;
  // The stable aui item.id (the constructor chatId). Unlike daemonId, this never
  // changes when a __LOCALID_* thread adopts its remote id — onNew uses it as the
  // createForLocal localId so the draft lookup keys off the same id the picker used.
  private readonly threadId: string;
  // WS attachment (subscribe / ack-gating / resume / reconnect refresh / restore).
  // Constructed lazily in subscribeLive() so it always carries the current daemonId.
  private wsSub: ChatWsSubscription | null = null;

  constructor(
    chatId: string,
    private readonly port: number,
    private readonly ws: DaemonWsClient,
  ) {
    this.daemonId = chatId;
    this.threadId = chatId;
    this.state = createChatThreadState(chatId);
  }

  // --------------------------------------------------------------------------
  // useSyncExternalStore interface
  // --------------------------------------------------------------------------

  public getState(): ChatThreadState {
    return this.state;
  }

  /** The stable aui item.id (constructor chatId) — onNew's createForLocal localId. */
  public getThreadId(): string {
    return this.threadId;
  }

  /** True once a daemon chat id is known (pre-existing thread, or after setRemoteId). */
  public hasRemoteId(): boolean {
    return this.remoteIdSet || !this.isLocalOnly();
  }

  /**
   * State-change subscription — ALWAYS available, never opens a WS sub. Backs
   * useControllerState so a dormant (backgrounded) thread still re-renders from
   * in-memory state. Does NOT keep the chat warm on the wire.
   */
  public subscribeState(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Live (wire) subscription — open the WS sub + resume loop. Call ONLY when the
   * thread is the active (main) one. Ref-counted + idempotent (StrictMode-safe).
   * No-op for a __LOCALID_* thread: there is no daemon chat to subscribe to yet.
   * Returns a teardown that drops the WS sub once the last live ref releases.
   */
  public subscribeLive(): () => void {
    if (this.isLocalOnly()) return () => {};
    this.liveRefs += 1;
    if (this.liveRefs === 1) {
      this.wsSub = new ChatWsSubscription(this.makeWsHost());
      this.wsSub.attach();
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.liveRefs -= 1;
      if (this.liveRefs === 0) {
        this.wsSub?.detach();
        this.wsSub = null;
      }
    };
  }

  private isLocalOnly(): boolean {
    return this.daemonId.startsWith('__LOCALID_');
  }

  private makeWsHost(): ChatWsHost {
    return {
      chatId: this.daemonId,
      port: this.port,
      ws: this.ws,
      onEvent: (event) => this.routeDaemonEvent(event),
      getRecentlyReplied: () => this.recentlyRepliedToolUseIds,
      getHeldPermissionIds: () => new Set(Object.keys(this.state.interactions.permissions)),
      dispatchPermission: (request) =>
        this.dispatch({ type: 'permission.requested', requestId: request.requestId, request }),
      onReconnectRefresh: () => this.refreshInBackground(),
      isDisposed: () => this.disposed,
    };
  }

  // --------------------------------------------------------------------------
  // Lifecycle
  // --------------------------------------------------------------------------

  /**
   * Adopt the daemon chat id for a thread created this session (S2). Set once by
   * the new-thread coordinator after createChat; thereafter all network ops use
   * it and subscribeLive() can open a real WS sub. No id-flip in aui — the
   * thread's item.id stays __LOCALID_*; only this network id changes.
   */
  public setRemoteId(remoteId: string): void {
    if (this.remoteIdSet) {
      if (this.daemonId === remoteId) return;
      throw new Error(`[chat-controller] setRemoteId called twice (${this.daemonId} → ${remoteId})`);
    }
    this.remoteIdSet = true;
    this.daemonId = remoteId;
  }

  public dispose(): void {
    this.disposed = true;
    this.wsSub?.detach();
    this.wsSub = null;
    this.listeners.clear();
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

    // Seed the composer config from REST so the toolbar isn't empty before the
    // first chat.updated; thereafter chat.updated keeps it live (the composer
    // reads state.chatConfig — no its own fetch).
    if (!this.state.chatConfig) {
      void getChat(this.port, this.daemonId)
        .then((chat) => {
          if (!this.disposed) this.dispatch({ type: 'chat.config.updated', chat });
        })
        .catch((err: unknown) => console.warn('[chat-controller] seed chat config failed', err));
    }

    const request = getChatMessages(this.port, this.daemonId)
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

    // Seed history against the current daemonId before the first send. A new
    // (local→remote) thread is created, then sent into without ever mounting the
    // load effect, so its just-created daemon chat (chat-99, not the stale
    // __LOCALID_*) must be loaded here. Deduped: skips once a load is in flight
    // or already settled, so repeat sends don't refetch.
    if (!this.loadPromise && this.state.loadState.type === 'idle') void this.load();

    const pending: PendingUserMessage = {
      clientId: createLocalId('local'),
      chatId: this.daemonId,
      text,
      createdAt: Date.now(),
      status: 'pending',
    };

    this.dispatch({ type: 'local.message.queued', pending });
    this.dispatch({ type: 'run.started' });

    try {
      // Upload attachments first → reference them by id (the daemon stores the bytes).
      const attachmentIds =
        uploadItems.length > 0 ? await uploadAttachments(this.port, this.daemonId, uploadItems) : undefined;
      this.ws.send({
        type: 'message.send',
        chatId: this.daemonId,
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
      await interruptChat(this.port, this.daemonId);
    } catch (error) {
      this.dispatch({ type: 'run.failed', error });
      throw error;
    }
  }

  public async replyToPermission(response: ControlResponse): Promise<void> {
    // Optimistically drop the gate, but remember we answered this tool use so a
    // racing restore (subscribe/reconnect REST read of the not-yet-cleared
    // pending) doesn't resurrect it, and verify the answer actually landed.
    // `response.requestId` is the request's own id — no separate arg to desync.
    this.recentlyRepliedToolUseIds.add(response.toolUseId);
    this.ws.send({ type: 'permission.respond', chatId: this.daemonId, response });
    this.dispatch({ type: 'permission.resolved', requestId: response.requestId });
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
      void getPendingPermission(this.port, this.daemonId)
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
    await cancelQueuedMessage(this.port, this.daemonId, messageId);
  }

  public async editQueued(messageId: string, content: string): Promise<void> {
    await editQueuedMessage(this.port, this.daemonId, messageId, content);
  }

  // --------------------------------------------------------------------------
  // Event routing
  // --------------------------------------------------------------------------

  private routeDaemonEvent(event: DaemonEvent): void {
    // subscribe:ack is consumed by ChatWsSubscription before it reaches here, so
    // routing only sees real daemon events (ack-gating lives in the helper now).

    // Keep the composer config (model/plan/permission/effort/features) live:
    // mirror the daemon's chat metadata into state so the toolbar reflects
    // daemon-side changes (e.g. the agent exiting plan mode). This is additive —
    // handleDaemonEvent below still maps chat.updated → run.started/stopped.
    if (event.type === 'chat.updated' && event.chat.id === this.daemonId) {
      this.dispatch({ type: 'chat.config.updated', chat: event.chat });
    }

    // A queued-message cancel the daemon couldn't honor leaves the message
    // queued — surface it (the reducer keeps state, so there's no other signal).
    if (event.type === 'message.queued.cancel_failed' && event.chatId === this.daemonId) {
      toast.error("Couldn't cancel the queued message", {
        description: 'It will still be sent when the current run finishes.',
      });
    }

    const result = handleDaemonEvent(event, this.daemonId, this.state.messagesById);

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
