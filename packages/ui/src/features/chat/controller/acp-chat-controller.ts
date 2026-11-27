import { SubagentHistoryClient } from './subagent-history-client';
import type { AppendMessage } from '@assistant-ui/react';
import type { Chat, ControlResponse, PromptRemedy } from '@qlan-ro/mainframe-types';
import type { DaemonWsClient } from '../../../lib/daemon/ws-client';
import { getAcpFacadeClient } from '../../../lib/daemon/acp-clients';
import type { AcpSessionClientPort } from './acp-session-plane';
import {
  cancelQueuedMessage,
  editQueuedMessage,
  getChat,
  interruptChat,
  resumeQueuedMessages,
} from '../../../lib/api/chats';
import { emitUserSent } from './user-sent';
import {
  createChatThreadState,
  reduceChatThreadState,
  type ChatThreadState,
  type ChatStateEvent,
} from './chat-thread-state';
import { AcpSessionPlane } from './acp-session-plane';
import { reconcilePendings } from './chat-reconcile';
import {
  acceptWorktreeOffer,
  dismissWorktreeOffer,
  dropFailedMessage,
  markAttachmentsRestoredForFailure,
  holdQueuedMessages,
  retryChatMessage,
  sendChatMessage,
  sendHeldMessages,
  type ChatActionHost,
} from './chat-actions';
import { matchQueued } from '../composer/queue/sent-order';
import { useHeldQueue } from '../composer/queue/held-queue-store';
import { ChatPlaneLoader } from './chat-plane-loader';
import { getActiveDaemon } from '../../../lib/daemon/active-daemon';
import { ChatActivation } from './chat-activation';
import { ChatLiveSubscription } from './chat-live-subscription';

/** What the controller needs from a facade client: the plane's port plus the connect handshake. */
export type AcpClientHandle = AcpSessionClientPort & { ensureConnected(): Promise<unknown> };

export class AcpChatController {
  private state: ChatThreadState;
  private readonly listeners = new Set<() => void>();
  private readonly plane: AcpSessionPlane;
  private readonly loader: ChatPlaneLoader;
  private disposed = false;
  private readonly targetId = getActiveDaemon().id;
  /** Bumped by each config broadcast, each applied response and the start of each re-read: the latest wins. */
  private configVersion = 0;
  private modelRequests = 0;
  // The id for all network ops: the daemon chat id for pre-existing threads; for a
  // new (__LOCALID_*) thread it starts local and setRemoteId() swaps in the real id
  // once createChat resolves. Neither plane opens while this is still local.
  private daemonId: string;
  private remoteIdSet = false;
  // D2 dormancy: gates the facade plane's subscription; liveSub gates the side-band WS the same way.
  private readonly activation: ChatActivation;
  private readonly liveSub: ChatLiveSubscription;
  // The stable aui item.id (constructor chatId) — never changes on adopt, so onNew
  // uses it as the createForLocal localId (same key the picker's draft uses).
  private readonly threadId: string;
  // The narrow surface the chat-actions module drives (send/retry/worktree offers).
  private readonly actionHost: ChatActionHost;

  constructor(
    chatId: string,
    private readonly port: number,
    private readonly ws: DaemonWsClient,
    /** Test seam — production resolves the shared per-profile client. */
    private readonly resolveClient: (profile: string) => AcpClientHandle = getAcpFacadeClient,
  ) {
    this.daemonId = chatId;
    this.threadId = chatId;
    this.state = createChatThreadState(chatId);
    this.plane = new AcpSessionPlane({
      getChatId: () => this.daemonId,
      dispatch: (event) => this.dispatchFromPlane(event),
      isDisposed: () => this.disposed,
    });
    this.actionHost = {
      getPort: () => this.port,
      getDaemonId: () => this.daemonId,
      getState: () => this.state,
      dispatch: (event) => this.dispatch(event),
      load: () => this.load(),
      sendPrompt: (text, meta) => this.plane.sendPrompt(text, meta),
      announceUserSend: () => this.announceUserSend(),
    };
    this.loader = new ChatPlaneLoader({
      getPort: () => this.port,
      getDaemonId: () => this.daemonId,
      isLocalOnly: () => this.isLocalOnly(),
      isDisposed: () => this.disposed,
      isReady: () => this.state.loadState.type === 'ready',
      isActive: () => this.activation.isActive,
      dispatch: (event) => this.dispatch(event),
      resolveClient: (profile) => this.resolveClient(profile),
      bindPlane: (client) => this.plane.bindClient(client),
      reactivatePlane: (client) => this.reactivatePlane(client),
    });
    this.activation = new ChatActivation({
      isLocalOnly: () => this.isLocalOnly(),
      isReady: () => this.state.loadState.type === 'ready',
      getClient: () => this.loader.getClient(),
      load: () => this.load(),
      reactivatePlane: (client) => this.reactivatePlane(client),
      detachPlane: () => this.plane.detach(),
    });
    this.liveSub = new ChatLiveSubscription({
      isLocalOnly: () => this.isLocalOnly(),
      isDisposed: () => this.disposed,
      getChatId: () => this.daemonId,
      getPort: () => this.port,
      getWs: () => this.ws,
      dispatch: (event) => {
        if (event.type === 'chat.config.updated') this.configVersion += 1;
        this.dispatch(event);
      },
      isFacadeAttached: () => this.plane.isAttached,
    });
  }

  isHistoryContext = (itemId: string) => this.plane.history.isContextItem(itemId);

  /** Changes when a history load on its way is dropped. */
  get historyGeneration(): number {
    return this.plane.history.loadGeneration;
  }

  loadEarlier(untilItemId?: string): Promise<boolean> {
    return this.plane.history.load(untilItemId);
  }

  /** Scrolling down from a window around a jump target: the next items, and at its end the live tail. */
  loadLater(): Promise<boolean> {
    return this.plane.history.loadLater();
  }

  /** Leaves a window around a jump target for the live tail. */
  returnToTail(): void {
    this.plane.history.returnToTail();
  }

  /** The reader is back at the tail: cut the window back to its newest page. */
  trimToNewestPage(): void {
    this.plane.history.trim();
  }

  private async reactivatePlane(client: AcpClientHandle): Promise<void> {
    // Wait for a validated initial transcript before opening the replay.
    await this.liveSub.whenTranscriptReady();
    if (this.disposed || !this.activation.isActive || this.loader.getClient() !== client) return;
    await this.plane.reactivate(client);
  }
  readonly subagentHistory = new SubagentHistoryClient(
    async () => {
      await this.load();
      return this.loader.getClient();
    },
    () => this.daemonId,
  );

  searchHistory(query: string) {
    return this.plane.history.search(query);
  }
  get canSearchHistory(): boolean {
    return this.plane.canSearchHistory;
  }

  // useSyncExternalStore interface

  public getState(): ChatThreadState {
    return this.state;
  }

  /** The stable aui item.id (constructor chatId) — onNew's createForLocal localId. */
  public getThreadId(): string {
    return this.threadId;
  }

  /** Current network id: the daemon chat id once adopted, else the local id. */
  public getDaemonId(): string {
    return this.daemonId;
  }

  /** True once a daemon chat id is known (pre-existing thread, or after setRemoteId). */
  public hasRemoteId(): boolean {
    return this.remoteIdSet || !this.isLocalOnly();
  }

  /** State-change subscription — ALWAYS available; backs useControllerState. */
  public subscribeState(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Side-band (legacy WS) subscription — call ONLY for the active thread.
   * Ref-counted + idempotent (StrictMode-safe). No-op for a local thread.
   * The facade plane is gated separately, by `setActive` — the runtime
   * hook's `opts.active` effect calls both.
   */
  public subscribeLive(): () => void {
    return this.liveSub.subscribe();
  }

  private isLocalOnly(): boolean {
    return this.daemonId.startsWith('__LOCALID_');
  }

  /**
   * Gates the facade plane's subscription (D2 dormancy, T33) from the runtime
   * hook's `opts.active` effect (the one gating `subscribeLive`); idempotent.
   * `holdActive` keeps it attached while a workspace tab shows the chat.
   */
  public setActive(active: boolean): void {
    this.activation.setActive(active);
  }
  /** Another view (the main thread, a workspace tab, a task row) still has this chat attached or subscribed. */
  public isInUse(): boolean {
    return this.activation.isActive || this.liveSub.isSubscribed;
  }
  public holdActive(): () => void {
    return this.activation.hold();
  }

  /**
   * Adopt the daemon chat id for a thread created this session (S2). Set once;
   * thereafter all network ops use it and both planes can open. No id-flip in
   * aui — item.id stays __LOCALID_*; only this network id changes. A
   * `__LOCALID_*` thread can be marked active before it has a remote id
   * (nothing to attach to yet, D2) — re-check activation here too, or an
   * already-active new thread would never attach once adopted.
   */
  public setRemoteId(remoteId: string): void {
    if (this.remoteIdSet) {
      if (this.daemonId === remoteId) return;
      throw new Error(`[acp-chat] setRemoteId called twice (${this.daemonId} → ${remoteId})`);
    }
    this.remoteIdSet = true;
    this.daemonId = remoteId;
    // Flip the public state snapshot's chatId too — every extras.state.chatId
    // reader (composer tuning, the diff-expand fetch, the @-file search scope)
    // must stop targeting the dead __LOCALID_* id from this point on.
    this.dispatch({ type: 'chat.id.adopted', chatId: remoteId });
    void this.load().catch((err: unknown) => console.warn('[acp-chat] post-adopt load failed', err));
    this.activation.onRemoteIdAdopted();
  }

  public dispose(): void {
    this.disposed = true;
    this.liveSub.dispose();
    this.plane.dispose();
    this.listeners.clear();
  }

  /** REST config seed + client bind (and attach, if active), deduped — see `ChatPlaneLoader`. */
  public load(force = false): Promise<void> {
    return this.loader.load(force);
  }

  public refresh(): Promise<void> {
    return this.load(true);
  }

  /** The user's own send (composer, Compact, review comments via `onNew`), announced once its bubble is in state. */
  public sendMessage(message: AppendMessage): Promise<void> {
    return sendChatMessage(this.actionHost, message);
  }

  /** Tells this chat's transcript the user sent something (`user-sent.ts`). */
  private announceUserSend(): void {
    this.plane.history.returnToTail();
    emitUserSent([this.threadId, this.daemonId]);
  }

  public markAttachmentsRestoredForFailure(error: unknown): void {
    markAttachmentsRestoredForFailure(this.actionHost, error);
  }

  /** Re-send a failed optimistic user message, applying its `remedy` first. */
  public retryMessage(clientId: string, remedy?: PromptRemedy): Promise<void> {
    return retryChatMessage(this.actionHost, clientId, remedy);
  }

  /** Take the failed bubble of a draft's first message off the transcript. */
  public dropFailedMessage(unsentId: string): void {
    dropFailedMessage(this.actionHost, unsentId);
  }

  public async cancel(): Promise<void> {
    // Before the guard: "Send now" can be under way before its turn shows.
    useHeldQueue.getState().releaseUnsent(this.daemonId);
    const adapter = this.state.chatConfig?.adapterId;
    const daemonQueue = adapter === 'claude' || adapter === 'codex';
    if (this.state.runState.type !== 'running') {
      if (daemonQueue) await interruptChat(this.port, this.daemonId);
      return;
    }
    this.dispatch({ type: 'run.cancelling' });
    if (!daemonQueue) await holdQueuedMessages(this.actionHost);
    try {
      this.plane.cancel();
    } catch (error) {
      this.dispatch({ type: 'run.failed', error });
      throw error;
    }
  }

  /**
   * Answer a gate. Optimistic removal only: if the answer dies with the
   * socket, the facade reconnect's resume redelivers the still-open gate —
   * the delivery-verify tracker the legacy path needed is retired.
   */
  public async replyToPermission(response: ControlResponse, selectedOptionId?: string): Promise<void> {
    this.plane.replyToPermission(response, selectedOptionId);
  }

  /** Send a message a Stop held back, and line up the ones behind it. */
  public sendHeld(messageId: string): Promise<void> {
    return sendHeldMessages(this.actionHost, messageId);
  }

  /** Resume a paused queue: the daemon sends the oldest held prompt as the next turn. */
  public async resumeQueue(): Promise<void> {
    await resumeQueuedMessages(this.port, this.daemonId);
    this.announceUserSend();
  }

  public async cancelQueued(messageId: string): Promise<void> {
    await cancelQueuedMessage(this.port, this.daemonId, messageId);
  }

  public async editQueued(messageId: string, content: string): Promise<void> {
    // Its place in the held queue goes by its text until its id is known: learn that first.
    matchQueued(this.daemonId, Object.values(this.getState().interactions.queued));
    await editQueuedMessage(this.port, this.daemonId, messageId, content);
  }

  public acceptWorktreeOffer(worktreePath: string): Promise<void> {
    return acceptWorktreeOffer(this.actionHost, worktreePath);
  }

  public dismissWorktreeOffer(worktreePath: string): Promise<void> {
    return dismissWorktreeOffer(this.actionHost, worktreePath);
  }

  /** Drops the settled confirmation once the banner has shown it. */
  public clearWorktreeSwitch(): void {
    this.dispatch({ type: 'worktree.switch.cleared' });
  }

  /**
   * Plane dispatches route through here so the count-aware optimistic
   * reconcile (judo-A) runs against every transcript refresh — but ONLY
   * against user messages the plane has never fed it before, not the whole
   * history (R3.3, T25): feeding the full list let an already-loaded
   * historical duplicate satisfy a brand-new pending before its own live
   * echo ever arrived.
   */
  private dispatchFromPlane(event: ChatStateEvent): void {
    if (event.type === 'transcript.updated') {
      const raw = this.plane.takeUnreconciledUserMessages();
      for (const clientId of reconcilePendings(this.state.pendingUserMessages, raw)) {
        this.dispatch({ type: 'local.message.reconciled', clientId });
      }
    }
    this.dispatch(event);
  }

  public async reconcileModelResponse(chatId: string, request: () => Promise<Chat | undefined>): Promise<void> {
    const matches = () => !this.disposed && this.daemonId === chatId && getActiveDaemon().id === this.targetId;
    const usable = (chat: Chat | undefined): chat is Chat =>
      chat?.id === chatId &&
      typeof chat.adapterId === 'string' &&
      (chat.model === undefined || typeof chat.model === 'string');
    if (!matches()) return;
    const atStart = this.configVersion;
    const requestId = ++this.modelRequests;
    const response = await request();
    if (!matches()) return;
    // A response is only current when nothing else has changed or is changing the chat; otherwise ask the daemon.
    const current = this.configVersion === atStart && requestId === this.modelRequests && usable(response);
    const version = ++this.configVersion;
    const chat = current ? response : await getChat(this.port, chatId);
    if (!matches() || this.configVersion !== version) return;
    if (!usable(chat)) throw new Error('Could not reload the chat configuration');
    this.dispatch({ type: 'chat.config.updated', chat });
  }

  /** Single dispatch choke point. `run.started` (any source) and `run.failed` both cancel the plane's deferred `run.stopped` (D7 finding 10) — a failure inside the settle delay must not be clobbered by the stale deferred idle. */
  private dispatch(event: ChatStateEvent): void {
    if (event.type === 'run.started' || event.type === 'run.failed') this.plane.cancelPendingStop();
    // A window around a jump target is a snapshot: these events may have outdated it.
    if (event.type === 'run.stopped' || event.type === 'compact.done' || event.type === 'transcript.cleared') {
      this.plane.history.resnapshot();
    }
    const nextState = reduceChatThreadState(this.state, event);
    if (nextState === this.state) return;
    this.state = nextState;
    for (const listener of this.listeners) listener();
  }
}
