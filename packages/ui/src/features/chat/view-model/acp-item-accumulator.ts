/**
 * Client-side mirror of the daemon's per-session diff engine
 * (`mainframe-acp::session_state`, todo #350 plan task 13): applies a stream
 * of `SessionUpdate` notifications into stable-id-addressed items, the same
 * way the server accumulates them before diffing. Patch-field semantics
 * match the wire grammar exactly (`tool-call.ts`'s module doc): a field
 * *absent* from the JSON leaves the current value unchanged, `null` clears
 * it, a value replaces it. JSON can't carry a literal `undefined`, so after
 * `JSON.parse` those three states are exactly `undefined` / `null` / value —
 * no separate presence check is needed.
 *
 * Message/thought items hold an ordered `ContentBlock` list (spec Decision
 * 22). A chunk appends to it, coalescing text into a trailing text block —
 * lossless because the encoder never emits adjacent text blocks — while an
 * upsert replaces the whole list.
 *
 * **Strict creation (D3 client half, long-chat-and-streaming plan task U1).**
 * `{ strictCreation: true }` — set when the daemon advertises
 * `itemCreationMarkers` — makes the accumulator refuse to fabricate an item
 * from a patch. Only a frame carrying `_meta["_mainframe.dev"].created ===
 * true` (`ITEM_CREATED_META_KEY`) may create an unknown id; any other frame
 * for an unknown id is left unapplied and reported as `needs-replay`, so the
 * caller can fall back to a bounded resync instead of rendering a
 * half-formed item under the wrong id. Legacy mode (the default, for daemons
 * that predate the capability) keeps today's create-from-any-frame
 * behavior. Every item also records its `origin` — `'replay'` while the
 * accumulator's `replaying` flag is set at creation time, `'live'`
 * otherwise, and unset in legacy mode — carried unchanged across later
 * patches.
 */
import type {
  ContentBlock,
  SessionState as AcpTurnState,
  SessionUpdate,
  ToolCallContent,
  UsageUpdate,
} from '@qlan-ro/mainframe-types';
import {
  appendBlock,
  APPLIED,
  APPLIED_CREATED,
  IGNORED,
  isCreationFrame,
  NEEDS_REPLAY,
  patchField,
  type AccumulatedItem,
  type AccumulatedItemRole,
  type AccumulatedMessageItem,
  type AccumulatedThoughtItem,
  type AccumulatedToolCallItem,
  type AccumulatorItemOrigin,
  type AcpItemAccumulatorOptions,
  type ApplyOutcome,
} from './accumulated-item';

export type {
  AccumulatedItem,
  AccumulatedItemRole,
  AccumulatedMessageItem,
  AccumulatedThoughtItem,
  AccumulatedToolCallItem,
  AccumulatorItemOrigin,
  AcpItemAccumulatorOptions,
  ApplyOutcome,
} from './accumulated-item';

export class AcpItemAccumulator {
  private readonly items = new Map<string, AccumulatedItem>();
  private readonly order: string[] = [];
  private turnState: AcpTurnState | null = null;
  private usage: UsageUpdate | null = null;
  private readonly strictCreation: boolean;
  /** True while frames applied here belong to a resume/full replay (D4 staging), stamped onto newly created items as `origin`. */
  private replaying = false;

  constructor(options: AcpItemAccumulatorOptions = {}) {
    this.strictCreation = options.strictCreation ?? false;
  }

  get itemsInOrder(): AccumulatedItem[] {
    return this.order.map((id) => this.items.get(id)!);
  }

  get latestTurnState(): AcpTurnState | null {
    return this.turnState;
  }

  get latestUsage(): UsageUpdate | null {
    return this.usage;
  }

  /** Set by the caller (U2's transcript store/window) before applying frames from a staged or visible replay target. */
  setReplaying(value: boolean): void {
    this.replaying = value;
  }

  reset(): void {
    this.items.clear();
    this.order.length = 0;
    this.turnState = null;
    this.usage = null;
  }

  apply(update: SessionUpdate): ApplyOutcome {
    switch (update.sessionUpdate) {
      case 'user_message_chunk':
        return this.applyChunk(update.messageId, 'user', false, update.content, update._meta);
      case 'agent_message_chunk':
        return this.applyChunk(update.messageId, 'agent', false, update.content, update._meta);
      case 'agent_thought_chunk':
        return this.applyChunk(update.messageId, 'agent', true, update.content, update._meta);
      case 'user_message':
        return this.applyUpsert(update.messageId, 'user', false, update.content, update._meta);
      case 'agent_message':
        return this.applyUpsert(update.messageId, 'agent', false, update.content, update._meta);
      case 'agent_thought':
        return this.applyUpsert(update.messageId, 'agent', true, update.content, update._meta);
      case 'tool_call_update':
        return this.applyToolCallUpdate(update);
      case 'tool_call_content_chunk':
        return this.applyToolCallContentChunk(update.toolCallId, update.content);
      case 'state_update':
        this.turnState = update;
        return APPLIED;
      case 'usage_update':
        this.usage = update;
        return APPLIED;
    }
  }

  private ensureOrdered(id: string): void {
    if (!this.items.has(id)) this.order.push(id);
  }

  /** `origin` for a freshly created item — unset in legacy mode, else driven by the `replaying` flag at creation time. */
  private originForCreate(): AccumulatorItemOrigin | undefined {
    if (!this.strictCreation) return undefined;
    return this.replaying ? 'replay' : 'live';
  }

  private applyChunk(
    id: string,
    role: AccumulatedItemRole,
    isThought: boolean,
    content: ContentBlock,
    meta: Record<string, unknown> | null | undefined,
  ): ApplyOutcome {
    const existed = this.items.has(id);
    // Chunks never carry the creation marker (only `create_update` does), so
    // in strict mode a chunk can only ever extend an already-known item.
    if (this.strictCreation && !existed) return NEEDS_REPLAY;

    this.ensureOrdered(id);
    const prior = this.items.get(id);
    const priorContent = prior && prior.kind !== 'tool-call' ? prior.content : [];
    const priorMeta = prior && prior.kind !== 'tool-call' ? prior.meta : undefined;
    const priorOrigin = prior && prior.kind !== 'tool-call' ? prior.origin : undefined;
    const blocks = appendBlock(priorContent, content);
    const origin = existed ? priorOrigin : this.originForCreate();
    const item: AccumulatedMessageItem | AccumulatedThoughtItem = isThought
      ? { kind: 'thought', id, content: blocks, meta: patchField(priorMeta, meta), origin }
      : { kind: 'message', id, role, content: blocks, meta: patchField(priorMeta, meta), origin };
    this.items.set(id, item);
    return existed ? APPLIED : APPLIED_CREATED;
  }

  private applyUpsert(
    id: string,
    role: AccumulatedItemRole,
    isThought: boolean,
    content: ContentBlock[] | null | undefined,
    meta: Record<string, unknown> | null | undefined,
  ): ApplyOutcome {
    const existed = this.items.has(id);
    // The clear frame is empty content AND an explicit `_meta: null` — the
    // exact shape the daemon's `clear_update` (session_state.rs) sends and
    // nothing else does. Empty content alone is not enough: a skill-loaded
    // or compaction pill is a real item whose whole payload is its meta.
    // Checked BEFORE ensureOrdered so an aborted partial stream that was
    // never ordered leaves no blank bubble above the real answer.
    if (content !== undefined && content !== null && content.length === 0 && meta === null) {
      if (!existed) return IGNORED;
      this.items.delete(id);
      const index = this.order.indexOf(id);
      if (index !== -1) this.order.splice(index, 1);
      return APPLIED;
    }

    // Strict mode: an unknown id needs the creation marker to become a
    // visible item at all. A known id is patched the same way regardless —
    // a marked re-create of a known id (D4's mid-replay continuation) just
    // replaces it in place through the ordinary patch-field grammar below,
    // because a creation frame always carries full content and meta.
    if (this.strictCreation && !existed && !isCreationFrame(meta)) return NEEDS_REPLAY;

    this.ensureOrdered(id);
    const prior = this.items.get(id);
    const priorContent = prior && prior.kind !== 'tool-call' ? prior.content : [];
    const priorMeta = prior && prior.kind !== 'tool-call' ? prior.meta : undefined;
    const priorOrigin = prior && prior.kind !== 'tool-call' ? prior.origin : undefined;
    const blocks = content === undefined ? priorContent : (content ?? []);
    const origin = existed ? priorOrigin : this.originForCreate();
    const item: AccumulatedMessageItem | AccumulatedThoughtItem = isThought
      ? { kind: 'thought', id, content: blocks, meta: patchField(priorMeta, meta), origin }
      : { kind: 'message', id, role, content: blocks, meta: patchField(priorMeta, meta), origin };
    this.items.set(id, item);
    return existed ? APPLIED : APPLIED_CREATED;
  }

  private applyToolCallUpdate(update: Extract<SessionUpdate, { sessionUpdate: 'tool_call_update' }>): ApplyOutcome {
    const id = update.toolCallId;
    const existed = this.items.has(id);
    if (this.strictCreation && !existed && !isCreationFrame(update._meta)) return NEEDS_REPLAY;

    this.ensureOrdered(id);
    const prior = this.items.get(id);
    const priorToolCall = prior?.kind === 'tool-call' ? prior : undefined;
    const origin = existed ? priorToolCall?.origin : this.originForCreate();
    const item: AccumulatedToolCallItem = {
      kind: 'tool-call',
      id,
      title: patchField(priorToolCall?.title, update.title),
      toolKind: patchField(priorToolCall?.toolKind, update.kind),
      status: patchField(priorToolCall?.status, update.status),
      content: patchField(priorToolCall?.content, update.content) ?? [],
      locations: patchField(priorToolCall?.locations, update.locations),
      rawInput: patchField(priorToolCall?.rawInput, update.rawInput),
      rawOutput: patchField(priorToolCall?.rawOutput, update.rawOutput),
      meta: patchField(priorToolCall?.meta, update._meta),
      origin,
    };
    this.items.set(id, item);
    return existed ? APPLIED : APPLIED_CREATED;
  }

  private applyToolCallContentChunk(id: string, content: ToolCallContent): ApplyOutcome {
    const existed = this.items.has(id);
    // A content chunk never carries the creation marker either.
    if (this.strictCreation && !existed) return NEEDS_REPLAY;

    this.ensureOrdered(id);
    const prior = this.items.get(id);
    const priorToolCall = prior?.kind === 'tool-call' ? prior : undefined;
    const origin = existed ? priorToolCall?.origin : this.originForCreate();
    const item: AccumulatedToolCallItem = {
      kind: 'tool-call',
      id,
      title: priorToolCall?.title,
      toolKind: priorToolCall?.toolKind,
      status: priorToolCall?.status,
      content: [...(priorToolCall?.content ?? []), content],
      locations: priorToolCall?.locations,
      rawInput: priorToolCall?.rawInput,
      rawOutput: priorToolCall?.rawOutput,
      meta: priorToolCall?.meta,
      origin,
    };
    this.items.set(id, item);
    return existed ? APPLIED : APPLIED_CREATED;
  }
}
