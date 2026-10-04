/**
 * The controller's ACP facade plane — transcript, turn state, and gates for
 * ONE chat over the shared per-profile `AcpFacadeClient`. Replaces the four
 * legacy reconnect re-seed paths with `session/resume`:
 *  - `subscribe:ack` re-seed + REST history refresh → `attach()`'s full
 *    replay / `resumeFromGap()`'s cursor replay (both in `acp-session-attachment.ts`);
 *  - queue snapshot → acceptance `_meta` (spec decision 11) + the facade's
 *    `_mainframe.dev/queue_state` snapshots (live changes and post-resume);
 *  - pending-permission recovery → resume redelivery: a live mid-turn gate
 *    and a redelivered one are the same `session/request_permission`, under
 *    the same `gate-{requestId}` correlation id — which is also why the
 *    legacy PermissionReplyTracker died: a reply lost to a dead socket
 *    resurfaces as a redelivered gate on the post-reconnect resume.
 *
 * Owns NO reducer state: it dispatches `ChatStateEvent`s into the host
 * (transcript, run state, permission entries) exactly like the side-band
 * router does, so the reducer stays the single state store.
 */
import type { ControlResponse, PromptSendMeta, SessionUpdate } from '@qlan-ro/mainframe-types';
import { MAINFRAME_META_NAMESPACE, UsageMetaSchema } from '@qlan-ro/mainframe-types';
import { TranscriptConverter } from '../view-model/convert-acp-item';
import type { AccumulatedItem } from '../view-model/acp-item-accumulator';
import type { ChatStateEvent } from './chat-thread-state';
import { AcpSessionAttachment, type AcpSessionClientPort } from './acp-session-attachment';
import { AcpTranscriptStore } from './acp-transcript-store';
import type { ReplayStage } from './acp-replay-stage';
import { AcpGateTracker } from './acp-session-gates';
import { RunStopSettle } from './acp-run-stop-settle';
import { ResumeCursorTracker } from './acp-resume-cursor';

export type { AcpSessionClientPort } from './acp-session-attachment';

/** The reconcile matcher's input shape (`chat-reconcile.ts`). */
type ReconcilableUserMessage = { content: Array<{ type: 'text'; text: string }> };

function asReconcilable(text: string): ReconcilableUserMessage {
  return { content: [{ type: 'text', text }] };
}

export interface AcpSessionPlaneHost {
  /** The daemon chat id at call time (it flips on `setRemoteId`). */
  getChatId: () => string;
  dispatch: (event: ChatStateEvent) => void;
  isDisposed: () => boolean;
}

export class AcpSessionPlane {
  /** Owns the visible + staging accumulators (D4) — `strictCreation` is read fresh per accumulator since capabilities are only known once a client attaches. */
  private readonly store = new AcpTranscriptStore(() => ({
    strictCreation: this.attachment?.currentClient?.mainframeCapabilities?.itemCreationMarkers === true,
  }));
  /** Owns both the legacy settled-item cursor and the durable revision cursor (todo #377) — see `acp-resume-cursor.ts`. */
  private readonly cursorTracker = new ResumeCursorTracker();
  /** Per-chat conversion cache: a frame re-converts only the container it touched, every other message keeps its identity. */
  private readonly converter = new TranscriptConverter();
  /** Item ids already fed to the reconcile matcher — see `takeUnreconciledUserMessages()`. */
  private readonly reconciledUserItemIds = new Set<string>();
  private readonly attachment: AcpSessionAttachment;
  private readonly gates: AcpGateTracker;
  private readonly runStop: RunStopSettle;

  constructor(private readonly host: AcpSessionPlaneHost) {
    this.runStop = new RunStopSettle({ dispatch: (event) => this.host.dispatch(event) });
    this.gates = new AcpGateTracker({
      dispatch: (event) => this.host.dispatch(event),
      requireClient: () => this.attachment.requireClient(),
    });
    this.attachment = new AcpSessionAttachment({
      getChatId: () => this.host.getChatId(),
      dispatch: (event) => this.host.dispatch(event),
      isDisposed: () => this.host.isDisposed(),
      nextReplayFrom: (capabilities) => this.cursorTracker.nextReplayFrom(capabilities),
      resetSettledCursor: () => this.cursorTracker.resetSettledCursor(),
      clearDurableCursor: () => this.cursorTracker.clearDurableCursor(),
      advanceCursorFromNotification: (cursor) => this.cursorTracker.advanceFromNotification(cursor),
      resetAccumulator: () => {
        this.store.resetAll();
        // `reconciledUserItemIds` deliberately survives: the replay that
        // refills the accumulator carries the same stable ids, and those
        // messages were reconciled once already (R3.3).
      },
      hasAccumulatedItems: () => this.store.accumulator.itemsInOrder.length > 0,
      onSessionUpdate: (update) => this.handleUpdate(update),
      onPermissionRequest: (rpcId, request) => this.gates.handleGate(rpcId, request),
      onGateResolvedForSession: (requestId) => this.gates.handleGateResolved(requestId),
      beginReplay: (opts) => this.beginReplay(opts),
      completeReplay: (opts) => this.completeReplay(opts),
      discardReplay: (opts) => this.discardReplay(opts),
    });
  }

  /** Bind to the shared per-profile client and full-replay this chat. Idempotent per client. */
  async attach(client: AcpSessionClientPort): Promise<void> {
    await this.attachment.attach(client);
  }

  /** Bind (or rebind) the client without subscribing — prompt/cancel/reply work from here; no wire traffic (D2, T33). */
  bindClient(client: AcpSessionClientPort): void {
    this.attachment.bindClient(client);
  }

  /** True while this session's facade subscription is live (D7, finding 9/10) — the side-band `isRunning:false` backstop is gated on this. */
  get isAttached(): boolean {
    return this.attachment.isSubscribed;
  }

  /** Re-establish the live stream after a detach — cursor resume from the last settled item, not a full replay (D2, T33). */
  async reactivate(client: AcpSessionClientPort): Promise<void> {
    await this.attachment.reactivate(client);
  }

  /** Drop the live stream (D2 dormancy): tells the daemon, stops listening, keeps the client bound. */
  detach(): void {
    this.attachment.detach();
  }

  /** Full re-replay of the current transcript (e.g. after a server-side wipe). */
  async reattach(): Promise<void> {
    await this.attachment.reattach();
  }

  async sendPrompt(text: string, sendMeta: PromptSendMeta): Promise<{ queued: boolean }> {
    const client = this.attachment.requireClient();
    // The daemon attaches THIS connection on the prompt path with a fresh stream even if a reconnect elsewhere beat this attachment's own gap (re-review LOW) — reconcile first, or the live turn this send starts routes into a stale window's staging and stays invisible until the late gap catches up.
    this.attachment.syncConnectionGeneration();
    const meta = Object.keys(sendMeta).length > 0 ? { _meta: { [MAINFRAME_META_NAMESPACE]: sendMeta } } : {};
    const response = await client.prompt(this.host.getChatId(), text, meta);
    const queuedState = response._meta?.[MAINFRAME_META_NAMESPACE] as { position?: number } | undefined;
    return { queued: queuedState?.position != null };
  }

  cancel(): void {
    this.attachment.requireClient().cancel(this.host.getChatId());
  }

  /** Answer a gate — see `AcpGateTracker.replyToPermission` (spec decision 12). */
  replyToPermission(response: ControlResponse, selectedOptionId?: string): void {
    this.gates.replyToPermission(response, selectedOptionId);
  }

  /**
   * Raw user-message texts straight from the accumulator — the reconcile
   * matcher's input. Raw, not converted: conversion strips sentinels
   * (captures, review comments) that the optimistic pending's sent text
   * still carries, and the multiset match must compare like with like.
   */
  userMessageContents(): ReconcilableUserMessage[] {
    return this.userItems().map(({ text }) => asReconcilable(text));
  }

  /**
   * The user messages never yet fed to the reconcile matcher, marking them
   * fed (R3.3, T25). Feeding it the whole history on every
   * `transcript.updated` let an already-loaded historical duplicate satisfy
   * a brand-new pending before that pending's own echo arrived. Keyed by the
   * item's stable id rather than a count, because a replay refills an
   * emptied accumulator one frame at a time: every count baseline a reset
   * could take is either stale or lands mid-replay.
   */
  takeUnreconciledUserMessages(): ReconcilableUserMessage[] {
    const fresh: ReconcilableUserMessage[] = [];
    for (const { id, text } of this.userItems()) {
      if (this.reconciledUserItemIds.has(id)) continue;
      this.reconciledUserItemIds.add(id);
      fresh.push(asReconcilable(text));
    }
    return fresh;
  }

  private userItems(): Array<{ id: string; text: string }> {
    return this.store.accumulator.itemsInOrder.flatMap((item) => {
      if (item.kind !== 'message' || item.role !== 'user') return [];
      const text = item.content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('');
      return [{ id: item.id, text }];
    });
  }

  dispose(): void {
    this.cancelPendingStop();
    this.attachment.dispose();
  }

  /** Cancels the deferred `run.stopped` an idle `state_update` scheduled (D7, finding 10) — see `acp-run-stop-settle.ts`. Called before forwarding ANY `run.started`, from any source. */
  cancelPendingStop(): void {
    this.runStop.cancel();
  }

  /**
   * Applies a frame to whichever window owns it right now — the FIFO-front
   * window's own stage, or `visible` when none is open (D4; per-window
   * ownership, todo #385). A `needs-replay` outcome (D3 strict mode) leaves
   * state untouched and routes to a bounded resync instead. While a FULL
   * stage is staging, state frames are captured on THAT stage for its own
   * `completeReplay()` to replay once, against the items it actually
   * published — never dispatched live, so a mid-replay snapshot can't flap
   * the run indicator or settle the cursor against the wrong (stale,
   * still-visible) transcript.
   */
  private handleUpdate(update: SessionUpdate): void {
    const stage = this.attachment.currentReplayStage();
    const outcome = this.store.apply(update, stage);
    this.attachment.recordApplyOutcome(outcome);
    if (outcome.kind === 'needs-replay') {
      this.attachment.routeNeedsReplay();
      return;
    }
    if (stage?.full) {
      if (update.sessionUpdate === 'state_update') stage.pendingState = update;
      return;
    }
    if (update.sessionUpdate === 'state_update') {
      this.applyStateUpdate(update, this.store.accumulator.itemsInOrder);
      return;
    }
    if (update.sessionUpdate === 'usage_update') {
      this.applyUsageUpdate(update);
      return;
    }
    this.refreshMessages();
  }

  /** `AcpSessionAttachmentHost.beginReplay` — a replay window opened (D4); returns that window's own stage. */
  private beginReplay(opts: { full: boolean }): ReplayStage {
    return this.store.openStage(opts.full);
  }

  /**
   * `AcpSessionAttachmentHost.completeReplay` — THIS window's own
   * `replay_complete` arrived normally. A full stage publishes its staged
   * items in one swap and dispatches `transcript.updated` exactly once, then
   * reconciles run state and the settled cursor from whatever `state_update`
   * it captured while staging — against the NOW-published items, never the
   * pre-replay ones. `store.publish` is a no-op (returns `null`) for a
   * cursor stage, or a stage that already published/discarded — a cursor
   * window already dispatched live, frame by frame, and a stale/duplicate
   * call dispatches nothing.
   */
  private completeReplay(stage: ReplayStage): void {
    // Committed before the full-stage-only `publish` early return (todo
    // #377): a cursor stage's `completeReplay` call is otherwise a no-op
    // here, and its reply cursor must still land.
    this.cursorTracker.commitReplyCursor(stage.replyCursor);
    const items = this.store.publish(stage);
    if (!items) return;
    this.refreshFrom(items);
    const state = stage.pendingState;
    stage.pendingState = null;
    if (state) this.applyStateUpdate(state, items);
  }

  /** `AcpSessionAttachmentHost.discardReplay` — THIS window's stage was discarded: a daemon `aborted:true`, or a previously client-aborted window's marker finally arriving. The visible transcript is untouched. */
  private discardReplay(stage: ReplayStage): void {
    stage.pendingState = null;
    this.store.discard(stage);
  }

  /**
   * `usage_update` → the context meter. The CLI's own percentage rides
   * `_meta["_mainframe.dev"]` (it accounts for the usable-window buffer, so
   * used/size is only the fallback when the meta is absent).
   */
  private applyUsageUpdate(update: Extract<SessionUpdate, { sessionUpdate: 'usage_update' }>): void {
    const meta = UsageMetaSchema.safeParse(update._meta?.[MAINFRAME_META_NAMESPACE]);
    const percentage = meta.success ? meta.data.percentage : update.size > 0 ? (update.used / update.size) * 100 : 0;
    this.host.dispatch({
      type: 'context.usage',
      percentage,
      totalTokens: update.used,
      maxTokens: update.size,
    });
  }

  /** `items` is explicit — the live accumulator's for a live frame, or the just-published items for a full stage's own `completeReplay()` — never the stale, pre-publish visible transcript. */
  private applyStateUpdate(
    update: Extract<SessionUpdate, { sessionUpdate: 'state_update' }>,
    items: AccumulatedItem[],
  ): void {
    if (update.state === 'running') {
      this.runStop.cancel();
      this.host.dispatch({ type: 'run.started' });
      return;
    }
    if (update.state === 'idle') {
      // The settled cursor is computed immediately — the `run.stopped`
      // dispatch itself waits out the settle delay (D7, finding 10).
      if (items.length > 0) this.cursorTracker.recordSettledItem(items[items.length - 1]!.id);
      this.runStop.scheduleStop();
    }
  }

  private refreshMessages(): void {
    this.refreshFrom(this.store.accumulator.itemsInOrder);
  }

  private refreshFrom(items: AccumulatedItem[]): void {
    const now = () => new Date();
    const messages = this.converter.convert(items, (id) => this.store.firstSeenAtOf(id, now));
    this.host.dispatch({ type: 'transcript.updated', messages });
  }
}
