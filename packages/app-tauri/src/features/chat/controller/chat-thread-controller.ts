/**
 * Per-chat controller — mirrors react-opencode's `OpenCodeThreadController`.
 *
 * Created once per thread id in the global registry and kept warm across
 * switches. `subscribeState` always feeds the UI from in-memory state;
 * `subscribeLive` opens the WS sub only while the thread is active. A new
 * (`__LOCALID_*`) thread adopts its daemon id via `setRemoteId` once createChat
 * resolves.
 *
 * It composes sibling helpers: `chat-event-router` (daemon-event side effects),
 * `chat-reconcile` (optimistic send + count-aware reconcile), `chat-queued-ops`
 * (queued cancel/edit), and `permission-reply-tracker` (reply delivery verify).
 */
import type { AppendMessage } from '@assistant-ui/react';
import type { ControlResponse, DisplayMessage } from '@qlan-ro/mainframe-types';
import type { DaemonWsClient } from '../../../lib/daemon/ws-client';
import { getChat, getChatMessages, interruptChat } from '../../../lib/api/chats';
import { uploadAttachments } from '../../../lib/api/attachments';
import {
  createChatThreadState,
  reduceChatThreadState,
  type ChatThreadState,
  type ChatStateEvent,
} from './chat-thread-state';
import { ChatWsSubscription, type ChatWsHost } from './chat-ws-subscription';
import { buildPendingMessage, parseSendInput, reconcilePendings } from './chat-reconcile';
import { PermissionReplyTracker } from './permission-reply-tracker';
import { cancelQueued as cancelQueuedOp, editQueued as editQueuedOp } from './chat-queued-ops';
import { routeDaemonEvent } from './chat-event-router';

export class ChatThreadController {
  private state: ChatThreadState;
  private readonly listeners = new Set<() => void>();
  private loadPromise: Promise<void> | null = null;
  private disposed = false;
  // Permission-reply reliability: re-check delivery (#2) and suppress restoring a
  // just-answered permission while the reply is still in flight (#5).
  private readonly permissionReplies: PermissionReplyTracker;
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
    this.permissionReplies = new PermissionReplyTracker({
      port: this.port,
      getChatId: () => this.daemonId,
      hasHeldPermission: (requestId) => requestId in this.state.interactions.permissions,
      dispatchPermission: (request) =>
        this.dispatch({ type: 'permission.requested', requestId: request.requestId, request }),
      isDisposed: () => this.disposed,
    });
  }

  // useSyncExternalStore interface

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
      onEvent: (event) =>
        routeDaemonEvent(event, {
          getChatId: () => this.daemonId,
          getState: () => this.state,
          dispatch: (e) => this.dispatch(e),
          refreshInBackground: () => this.refreshInBackground(),
        }),
      getRecentlyReplied: () => this.permissionReplies.recentlyRepliedToolUseIds,
      getHeldPermissionIds: () => new Set(Object.keys(this.state.interactions.permissions)),
      dispatchPermission: (request) =>
        this.dispatch({ type: 'permission.requested', requestId: request.requestId, request }),
      onReconnectRefresh: () => this.refreshInBackground(),
      isDisposed: () => this.disposed,
    };
  }

  // Lifecycle

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
    this.permissionReplies.dispose();
  }

  // Actions

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
    const input = parseSendInput(message);
    if (!input) return;
    const { text, uploadItems } = input;

    // Seed history against the current daemonId before the first send. A new
    // (local→remote) thread is created, then sent into without ever mounting the
    // load effect, so its just-created daemon chat (chat-99, not the stale
    // __LOCALID_*) must be loaded here. Deduped: skips once a load is in flight
    // or already settled, so repeat sends don't refetch.
    if (!this.loadPromise && this.state.loadState.type === 'idle') void this.load();

    const pending = buildPendingMessage(this.daemonId, text);
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
    this.permissionReplies.recordReply(response.toolUseId);
    this.ws.send({ type: 'permission.respond', chatId: this.daemonId, response });
    this.dispatch({ type: 'permission.resolved', requestId: response.requestId });
  }

  public async cancelQueued(messageId: string): Promise<void> {
    await cancelQueuedOp(this.port, this.daemonId, messageId);
  }

  public async editQueued(messageId: string, content: string): Promise<void> {
    await editQueuedOp(this.port, this.daemonId, messageId, content);
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
