/**
 * Per-chat controller — the ONE desktop chat controller (desktop-cutover
 * pass; the legacy `chat-thread-controller.ts` is deleted). Two planes over
 * one reducer:
 *  - `AcpSessionPlane` (transcript, run frames, gates) on the shared
 *    per-adapter `/acp/{profile}` facade client — SUBSCRIBED only while
 *    active (D2 dormancy, todo #350 T33; gating logic in `chat-activation.ts`,
 *    load/bind in `chat-plane-loader.ts`). `load()` seeds config and binds
 *    the client unconditionally (prompt/cancel/reply work dormant too); a
 *    switch-back reactivates from the last settled item, never a full
 *    replay.
 *  - `ChatWsSubscription` (side-band: config, background tasks, worktree
 *    offers, workflow runs) gated to the active thread exactly as before.
 *
 * Created once per thread id in the global registry and kept warm across
 * switches. A new (`__LOCALID_*`) thread adopts its daemon id via
 * `setRemoteId` once createChat resolves; that's also where the adapter
 * profile becomes known. A `__LOCALID_*` thread can be marked active before
 * it has a remote id (nothing to attach yet) — adoption re-checks
 * activation. Queued cancel/edit and attachment upload stay REST; sends go
 * through `session/prompt` with the `_mainframe.dev` send meta.
 */
import type { AppendMessage } from '@assistant-ui/react';
import type { ControlResponse } from '@qlan-ro/mainframe-types';
import type { DaemonWsClient } from '../../../lib/daemon/ws-client';
import { getAcpFacadeClient } from '../../../lib/daemon/acp-clients';
import type { AcpSessionClientPort } from './acp-session-plane';
import { cancelQueuedMessage, editQueuedMessage } from '../../../lib/api/chats';
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
  markAttachmentsRestoredForFailure,
  retryChatMessage,
  sendChatMessage,
  type ChatActionHost,
} from './chat-actions';
import { ChatPlaneLoader } from './chat-plane-loader';
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
      reactivatePlane: (client) => this.plane.reactivate(client),
    });
    this.activation = new ChatActivation({
      isLocalOnly: () => this.isLocalOnly(),
      isReady: () => this.state.loadState.type === 'ready',
      getClient: () => this.loader.getClient(),
      load: () => this.load(),
      reactivatePlane: (client) => this.plane.reactivate(client),
      detachPlane: () => this.plane.detach(),
    });
    this.liveSub = new ChatLiveSubscription({
      isLocalOnly: () => this.isLocalOnly(),
      isDisposed: () => this.disposed,
      getChatId: () => this.daemonId,
      getPort: () => this.port,
      getWs: () => this.ws,
      dispatch: (event) => this.dispatch(event),
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
   * Gates the facade plane's subscription (D2 dormancy, T33) — called from
   * the runtime hook's `opts.active` effect, the same one that gates
   * `subscribeLive`. Idempotent on a repeat call with the same value.
   */
  public setActive(active: boolean): void {
    this.activation.setActive(active);
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

  public sendMessage(message: AppendMessage): Promise<void> {
    return sendChatMessage(this.actionHost, message);
  }

  public markAttachmentsRestoredForFailure(error: unknown): void {
    markAttachmentsRestoredForFailure(this.actionHost, error);
  }

  /** Re-send a failed optimistic user message (the "Failed to send" indicator). */
  public retryMessage(clientId: string): Promise<void> {
    return retryChatMessage(this.actionHost, clientId);
  }

  public async cancel(): Promise<void> {
    // Idle guard (#324 QA): cancelling an already-idle chat is a daemon no-op —
    // nothing would ever clear 'cancelling', stranding the "Working…" indicator.
    if (this.state.runState.type !== 'running') return;
    this.dispatch({ type: 'run.cancelling' });
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

  public async cancelQueued(messageId: string): Promise<void> {
    await cancelQueuedMessage(this.port, this.daemonId, messageId);
  }

  public async editQueued(messageId: string, content: string): Promise<void> {
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

  private dispatch(event: ChatStateEvent): void {
    const nextState = reduceChatThreadState(this.state, event);
    if (nextState === this.state) return;
    this.state = nextState;
    for (const listener of this.listeners) listener();
  }
}
