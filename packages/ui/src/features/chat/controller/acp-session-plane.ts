/**
 * The controller's ACP facade plane — transcript, turn state, and gates for
 * ONE chat over the shared per-profile `AcpFacadeClient`. Replaces the four
 * legacy reconnect re-seed paths with `session/resume`:
 *  - `subscribe:ack` re-seed + REST history refresh → `attach()`'s full
 *    replay / `resumeFromGap()`'s cursor replay;
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
import type {
  ControlRequest,
  ControlResponse,
  PromptSendMeta,
  RequestPermissionRequest,
  SessionUpdate,
} from '@qlan-ro/mainframe-types';
import { MAINFRAME_META_NAMESPACE, UsageMetaSchema } from '@qlan-ro/mainframe-types';
import { z } from 'zod';
import type { GapListener, ReplayCursor } from '../../../lib/daemon/acp-client';
import type {
  CompactionListener,
  QueueStateListener,
  TranscriptClearedListener,
  GateResolvedListener,
  PermissionRequestListener,
  SessionUpdateListener,
} from '../../../lib/daemon/acp-notification-router';
import type { JsonRpcRequestId, PromptRequest, PromptResponse, ResumeSessionResponse } from '@qlan-ro/mainframe-types';
import { AcpItemAccumulator } from '../view-model/acp-item-accumulator';
import { convertAcpItems } from '../view-model/convert-acp-item';
import { buildAcpRichAnswer } from '../gates/build-acp-permission-response';
import type { ChatStateEvent } from './chat-thread-state';

const ResumeMetaSchema = z
  .object({ itemCount: z.number().int().optional(), fullReplay: z.boolean().optional() })
  .loose();

const GateMetaSchema = z.object({ controlRequest: z.record(z.string(), z.unknown()) }).loose();

/** The `AcpFacadeClient` surface this plane needs — narrowed so a test double doesn't reimplement the whole client. */
export interface AcpSessionClientPort {
  onSessionUpdate(listener: SessionUpdateListener): () => void;
  onPermissionRequest(listener: PermissionRequestListener): () => void;
  onGateResolved(listener: GateResolvedListener): () => void;
  onCompaction(listener: CompactionListener): () => void;
  onTranscriptCleared(listener: TranscriptClearedListener): () => void;
  onQueueState(listener: QueueStateListener): () => void;
  onGap(listener: GapListener): () => void;
  prompt(sessionId: string, text: string, extra?: Pick<PromptRequest, '_meta'>): Promise<PromptResponse>;
  cancel(sessionId: string): void;
  resume(sessionId: string, cwd: string, replayFrom?: ReplayCursor): Promise<ResumeSessionResponse>;
  respondPermission(id: JsonRpcRequestId, response: import('@qlan-ro/mainframe-types').RequestPermissionResponse): void;
}

export interface AcpSessionPlaneHost {
  /** The daemon chat id at call time (it flips on `setRemoteId`). */
  getChatId: () => string;
  dispatch: (event: ChatStateEvent) => void;
  isDisposed: () => boolean;
}

export class AcpSessionPlane {
  private client: AcpSessionClientPort | null = null;
  private readonly accumulator = new AcpItemAccumulator();
  private readonly firstSeenAt = new Map<string, Date>();
  /** ControlRequest.requestId → the JSON-RPC id its gate traveled under. */
  private readonly gateRpcIds = new Map<string, JsonRpcRequestId>();
  private readonly unsubscribe: Array<() => void> = [];
  private hasAttached = false;
  /** Resume cursor: only advanced when the turn goes idle — a cursor into a still-streaming item would drop its tail (resume.rs replays up to and including the cursor at its CURRENT content). */
  private lastSettledItemId: string | null = null;

  constructor(private readonly host: AcpSessionPlaneHost) {}

  /** Bind to the shared per-profile client and full-replay this chat. Idempotent per client. */
  async attach(client: AcpSessionClientPort): Promise<void> {
    if (this.client !== client) {
      this.detachListeners();
      this.client = client;
      this.unsubscribe.push(
        client.onSessionUpdate((sessionId, update) => {
          if (sessionId === this.host.getChatId()) this.handleUpdate(update);
        }),
        client.onPermissionRequest((id, request) => {
          if (request.sessionId === this.host.getChatId()) this.handleGate(id, request);
        }),
        client.onGateResolved((sessionId, requestId) => {
          if (sessionId === this.host.getChatId()) this.handleGateResolved(requestId);
        }),
        client.onCompaction((sessionId, phase) => {
          if (sessionId !== this.host.getChatId()) return;
          this.host.dispatch({ type: phase === 'started' ? 'compact.started' : 'compact.done' });
        }),
        client.onTranscriptCleared((sessionId) => {
          if (sessionId !== this.host.getChatId()) return;
          // The server wiped the transcript (plan-mode clear-context): drop
          // the local projection and re-replay so tool-call items drop too.
          this.host.dispatch({ type: 'transcript.cleared' });
          void this.reattach().catch(() => undefined);
        }),
        client.onQueueState((sessionId, refs) => {
          if (sessionId !== this.host.getChatId()) return;
          // Always a full snapshot (never a delta) — the reducer replaces the
          // queued set wholesale, so stale turns cannot survive a reconnect.
          this.host.dispatch({ type: 'queued.snapshot', refs });
        }),
        client.onGap(() => void this.resumeFromGap()),
      );
    }
    await this.resume({ type: 'start' });
    this.hasAttached = true;
  }

  /** Full re-replay of the current transcript (e.g. after a server-side wipe). */
  async reattach(): Promise<void> {
    this.lastSettledItemId = null;
    await this.resume({ type: 'start' });
  }

  async sendPrompt(text: string, sendMeta: PromptSendMeta): Promise<{ queued: boolean }> {
    const client = this.requireClient();
    const meta = Object.keys(sendMeta).length > 0 ? { _meta: { [MAINFRAME_META_NAMESPACE]: sendMeta } } : {};
    const response = await client.prompt(this.host.getChatId(), text, meta);
    const queuedState = response._meta?.[MAINFRAME_META_NAMESPACE] as { position?: number } | undefined;
    return { queued: queuedState?.position != null };
  }

  cancel(): void {
    this.requireClient().cancel(this.host.getChatId());
  }

  /**
   * Answer a gate with the rich `_mainframe.dev` payload (spec decision 12).
   * `selectedOptionId` is the offered option the user actually clicked, so
   * the plain half of the answer is truthful end-to-end; only a gate that
   * answers without picking an option (Plan, AskUserQuestion) falls back to
   * a behavior-derived id. The daemon prefers the carried `ControlResponse`
   * either way, never inferring from the option.
   */
  replyToPermission(response: ControlResponse, selectedOptionId?: string): void {
    const rpcId = this.gateRpcIds.get(response.requestId) ?? `gate-${response.requestId}`;
    this.gateRpcIds.delete(response.requestId);
    const optionId = selectedOptionId ?? (response.behavior === 'deny' ? 'reject-once' : 'allow-once');
    this.requireClient().respondPermission(rpcId, buildAcpRichAnswer(optionId, response));
    this.host.dispatch({ type: 'permission.resolved', requestId: response.requestId });
  }

  /**
   * Raw user-message texts straight from the accumulator — the reconcile
   * matcher's input. Raw, not converted: conversion strips sentinels
   * (captures, review comments) that the optimistic pending's sent text
   * still carries, and the multiset match must compare like with like.
   */
  userMessageContents(): Array<{ content: Array<{ type: 'text'; text: string }> }> {
    return this.accumulator.itemsInOrder.flatMap((item) => {
      if (item.kind !== 'message' || item.role !== 'user') return [];
      const text = item.content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('');
      return [{ content: [{ type: 'text' as const, text }] }];
    });
  }

  dispose(): void {
    this.detachListeners();
    this.client = null;
  }

  private detachListeners(): void {
    this.unsubscribe.forEach((fn) => fn());
    this.unsubscribe.length = 0;
  }

  private requireClient(): AcpSessionClientPort {
    if (!this.client) throw new Error('[acp-session] not attached — no facade client yet');
    return this.client;
  }

  private async resume(cursor: ReplayCursor): Promise<void> {
    const client = this.requireClient();
    const response = await client.resume(this.host.getChatId(), '', cursor);
    const meta = ResumeMetaSchema.safeParse(response._meta?.[MAINFRAME_META_NAMESPACE]);
    const itemCount = meta.success ? (meta.data.itemCount ?? null) : null;
    const isFullReplay = cursor.type === 'start' || (meta.success && meta.data.fullReplay === true);
    if (!isFullReplay) return;
    // Refuse an empty full replay of a transcript we already hold — the
    // legacy `refusesEmptyRefresh` guard: "empty" from the daemon can mean
    // "no history session for this chat yet", never trust it to blank a
    // populated thread (the first attach is never refused, so a genuinely
    // empty thread still renders as one).
    if (itemCount === 0 && this.hasAttached && this.accumulator.itemsInOrder.length > 0) {
      console.warn(`[acp-session] refused an empty full replay for ${this.host.getChatId()}`);
      this.host.dispatch({ type: 'history.refresh.refused' });
      return;
    }
    this.accumulator.reset();
    this.firstSeenAt.clear();
  }

  private async resumeFromGap(): Promise<void> {
    if (this.host.isDisposed() || !this.hasAttached) return;
    const cursor: ReplayCursor = this.lastSettledItemId
      ? { type: 'item', itemId: this.lastSettledItemId }
      : { type: 'start' };
    try {
      await this.resume(cursor);
    } catch (error) {
      console.warn('[acp-session] resume-on-gap failed — a later gap/close will retry', error);
    }
  }

  private handleUpdate(update: SessionUpdate): void {
    this.accumulator.apply(update);
    if (update.sessionUpdate === 'state_update') {
      this.applyStateUpdate(update);
      return;
    }
    if (update.sessionUpdate === 'usage_update') {
      this.applyUsageUpdate(update);
      return;
    }
    this.refreshMessages();
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

  private applyStateUpdate(update: Extract<SessionUpdate, { sessionUpdate: 'state_update' }>): void {
    if (update.state === 'running') {
      this.host.dispatch({ type: 'run.started' });
      return;
    }
    if (update.state === 'idle') {
      const items = this.accumulator.itemsInOrder;
      this.lastSettledItemId = items.length > 0 ? items[items.length - 1]!.id : this.lastSettledItemId;
      this.host.dispatch({ type: 'run.stopped' });
    }
  }

  /**
   * `session/request_permission` → the legacy `ChatPermissionEntry` shape, from the
   * carried `ControlRequest` (spec: rich cards render it), plus the top-level
   * `options` the adapter offered — the gate renders those verbatim rather than a
   * client-guessed triad (spec decision 12).
   */
  private handleGate(rpcId: JsonRpcRequestId, request: RequestPermissionRequest): void {
    const parsed = GateMetaSchema.safeParse(request._meta?.[MAINFRAME_META_NAMESPACE]);
    if (!parsed.success) {
      console.warn('[acp-session] gate without a controlRequest payload dropped', request);
      return;
    }
    const control = parsed.data.controlRequest as unknown as ControlRequest;
    this.gateRpcIds.set(control.requestId, rpcId);
    this.host.dispatch({
      type: 'permission.requested',
      requestId: control.requestId,
      request: control,
      options: request.options,
    });
  }

  /** The gate resolved elsewhere (`_mainframe.dev/gate_resolved`); rpc ids are `gate-{requestId}`. */
  private handleGateResolved(rpcId: string): void {
    const requestId = rpcId.startsWith('gate-') ? rpcId.slice('gate-'.length) : rpcId;
    this.gateRpcIds.delete(requestId);
    this.host.dispatch({ type: 'permission.resolved', requestId });
  }

  private refreshMessages(): void {
    const items = this.accumulator.itemsInOrder;
    const now = () => new Date();
    for (const item of items) {
      if (!this.firstSeenAt.has(item.id)) this.firstSeenAt.set(item.id, now());
    }
    const messages = convertAcpItems(items, (id) => this.firstSeenAt.get(id) ?? now());
    this.host.dispatch({ type: 'transcript.updated', messages });
  }
}
