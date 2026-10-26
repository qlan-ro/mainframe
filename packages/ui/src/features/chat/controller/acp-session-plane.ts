import { AcpHistory } from './acp-history';
import { isHeldHistoryItem } from './acp-history-items';
import type { HistoryPageResult } from '@qlan-ro/mainframe-types';
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
  private readonly cursorTracker = new ResumeCursorTracker();
  /** Per-chat conversion cache: a frame re-converts only the container it touched, every other message keeps its identity. */
  private readonly converter = new TranscriptConverter();
  /** Item ids already fed to the reconcile matcher — see `takeUnreconciledUserMessages()`. */
  private readonly reconciledUserItemIds = new Set<string>();
  readonly history: AcpHistory;
  private readonly attachment: AcpSessionAttachment;
  private readonly gates: AcpGateTracker;
  private readonly runStop: RunStopSettle;

  constructor(private readonly host: AcpSessionPlaneHost) {
    this.runStop = new RunStopSettle({ dispatch: (event) => this.host.dispatch(event) });
    this.gates = new AcpGateTracker({
      dispatch: (event) => this.host.dispatch(event),
      requireClient: () => this.attachment.requireClient(),
    });
    this.history = new AcpHistory({
      chatId: () => this.host.getChatId(),
      client: () => this.attachment.requireClient(),
      active: () => this.attachment.canPageHistory && !this.host.isDisposed(),
      changed: (history) => this.host.dispatch({ type: 'history.window', history }),
      prepend: (page) => this.prependPage(page),
      hasItem: (id, floor) => isHeldHistoryItem(this.store.accumulator.itemsInOrder, id, floor),
    });
    this.attachment = new AcpSessionAttachment({
      getChatId: () => this.host.getChatId(),
      dispatch: (event) => this.host.dispatch(event),
      isDisposed: () => this.host.isDisposed(),
      nextReplayFrom: (capabilities) => this.cursorTracker.nextReplayFrom(capabilities),
      invalidateHistory: () => this.history.invalidate(),
      historyWindow: (cursor) => this.history.window(cursor),
      setHistory: (history) => this.history.reset(history),
      resetSettledCursor: () => this.cursorTracker.resetSettledCursor(),
      clearDurableCursor: () => {
        this.history.invalidate();
        this.cursorTracker.clearDurableCursor();
      },
      advanceCursorFromNotification: (cursor) => this.cursorTracker.advanceFromNotification(cursor),
      resetAccumulator: () => {
        this.history.invalidate();
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

  // Stable IDs prevent historical duplicates from reconciling a new optimistic send.
  takeUnreconciledUserMessages(): ReconcilableUserMessage[] {
    const fresh: ReconcilableUserMessage[] = [];
    for (const { id, text } of this.userItems()) {
      if (this.reconciledUserItemIds.has(id)) continue;
      this.reconciledUserItemIds.add(id);
      fresh.push(asReconcilable(text));
    }
    return fresh;
  }

  private prependPage(page: HistoryPageResult): void {
    const items = this.store.prepend(page.updates ?? []);
    for (const item of items) {
      if (item.kind === 'message' && item.role === 'user') this.reconciledUserItemIds.add(item.id);
    }
    if (items.length) {
      window.dispatchEvent(new CustomEvent('mainframe:history-prepend', { detail: this.host.getChatId() }));
      this.refreshMessages();
    }
  }

  get canSearchHistory(): boolean {
    return this.attachment.currentClient?.mainframeCapabilities?.historySearch === true;
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

  // A completed full stage publishes before reconciling the run state captured in that stage.
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
      const startedAtMs = update._meta?.['_mainframe.dev']?.startedAtMs;
      this.host.dispatch(startedAtMs === undefined ? { type: 'run.started' } : { type: 'run.started', startedAtMs });
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
