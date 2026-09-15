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
import type {
  ControlRequest,
  ControlResponse,
  PromptSendMeta,
  RequestPermissionRequest,
  SessionUpdate,
} from '@qlan-ro/mainframe-types';
import { MAINFRAME_META_NAMESPACE, UsageMetaSchema } from '@qlan-ro/mainframe-types';
import { z } from 'zod';
import type { JsonRpcRequestId } from '@qlan-ro/mainframe-types';
import { AcpItemAccumulator } from '../view-model/acp-item-accumulator';
import { convertAcpItems } from '../view-model/convert-acp-item';
import { buildAcpRichAnswer } from '../gates/build-acp-permission-response';
import type { ChatStateEvent } from './chat-thread-state';
import { resolveGateControlRequest } from './synthesize-control-request';
import { AcpSessionAttachment, type AcpSessionClientPort } from './acp-session-attachment';

export type { AcpSessionClientPort } from './acp-session-attachment';

const GateMetaSchema = z.object({ controlRequest: z.record(z.string(), z.unknown()) }).loose();

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
  private readonly accumulator = new AcpItemAccumulator();
  private readonly firstSeenAt = new Map<string, Date>();
  /** ControlRequest.requestId → the JSON-RPC id its gate traveled under. */
  private readonly gateRpcIds = new Map<string, JsonRpcRequestId>();
  /** Resume cursor: only advanced when the turn goes idle — a cursor into a still-streaming item would drop its tail (resume.rs replays up to and including the cursor at its CURRENT content). */
  private lastSettledItemId: string | null = null;
  /** Item ids already fed to the reconcile matcher — see `takeUnreconciledUserMessages()`. */
  private readonly reconciledUserItemIds = new Set<string>();
  private readonly attachment: AcpSessionAttachment;

  constructor(private readonly host: AcpSessionPlaneHost) {
    this.attachment = new AcpSessionAttachment({
      getChatId: () => this.host.getChatId(),
      dispatch: (event) => this.host.dispatch(event),
      isDisposed: () => this.host.isDisposed(),
      getLastSettledItemId: () => this.lastSettledItemId,
      resetSettledCursor: () => {
        this.lastSettledItemId = null;
      },
      resetAccumulator: () => {
        this.accumulator.reset();
        this.firstSeenAt.clear();
        // `reconciledUserItemIds` deliberately survives: the replay that
        // refills the accumulator carries the same stable ids, and those
        // messages were reconciled once already (R3.3).
      },
      hasAccumulatedItems: () => this.accumulator.itemsInOrder.length > 0,
      onSessionUpdate: (update) => this.handleUpdate(update),
      onPermissionRequest: (rpcId, request) => this.handleGate(rpcId, request),
      onGateResolvedForSession: (requestId) => this.handleGateResolved(requestId),
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
    const meta = Object.keys(sendMeta).length > 0 ? { _meta: { [MAINFRAME_META_NAMESPACE]: sendMeta } } : {};
    const response = await client.prompt(this.host.getChatId(), text, meta);
    const queuedState = response._meta?.[MAINFRAME_META_NAMESPACE] as { position?: number } | undefined;
    return { queued: queuedState?.position != null };
  }

  cancel(): void {
    this.attachment.requireClient().cancel(this.host.getChatId());
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
    this.attachment.requireClient().respondPermission(rpcId, buildAcpRichAnswer(optionId, response));
    this.host.dispatch({ type: 'permission.resolved', requestId: response.requestId });
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
    return this.accumulator.itemsInOrder.flatMap((item) => {
      if (item.kind !== 'message' || item.role !== 'user') return [];
      const text = item.content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('');
      return [{ id: item.id, text }];
    });
  }

  dispose(): void {
    this.attachment.dispose();
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
   * `session/request_permission` → `ChatPermissionEntry`: the carried `ControlRequest`
   * (rich cards render it) plus the wire-level `options` (rendered verbatim, spec
   * decision 12). A missing/unparseable `_meta` — version-skewed daemon, or a
   * non-Mainframe ACP agent — synthesizes a stand-in `ControlRequest` rather than
   * dropping the gate: `options` alone is the presentation floor (spec decision 27).
   */
  private handleGate(rpcId: JsonRpcRequestId, request: RequestPermissionRequest): void {
    const parsed = GateMetaSchema.safeParse(request._meta?.[MAINFRAME_META_NAMESPACE]);
    const carried = parsed.success ? (parsed.data.controlRequest as unknown as ControlRequest) : undefined;
    const { control, synthesized } = resolveGateControlRequest(rpcId, request, carried);
    if (synthesized) console.warn('[acp-session] gate has no usable controlRequest — rendering from options alone');
    this.gateRpcIds.set(control.requestId, rpcId);
    this.host.dispatch({
      type: 'permission.requested',
      requestId: control.requestId,
      request: control,
      options: request.options,
      synthesizedRequest: synthesized,
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
