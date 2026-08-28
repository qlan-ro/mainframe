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
 */
import type {
  ContentBlock,
  SessionState as AcpTurnState,
  SessionUpdate,
  ToolCallContent,
  ToolCallLocation,
  ToolCallStatus,
  ToolKind,
  UsageUpdate,
} from '@qlan-ro/mainframe-types';

export type AccumulatedItemRole = 'user' | 'agent';

export interface AccumulatedMessageItem {
  kind: 'message';
  id: string;
  role: AccumulatedItemRole;
  content: ContentBlock[];
  meta?: Record<string, unknown>;
}

export interface AccumulatedThoughtItem {
  kind: 'thought';
  id: string;
  content: ContentBlock[];
  meta?: Record<string, unknown>;
}

export interface AccumulatedToolCallItem {
  kind: 'tool-call';
  id: string;
  title?: string;
  toolKind?: ToolKind;
  status?: ToolCallStatus;
  content: ToolCallContent[];
  locations?: ToolCallLocation[];
  rawInput?: unknown;
  rawOutput?: unknown;
  meta?: Record<string, unknown>;
}

export type AccumulatedItem = AccumulatedMessageItem | AccumulatedThoughtItem | AccumulatedToolCallItem;

/** Append a chunk's block, coalescing text into a trailing text block. */
function appendBlock(blocks: ContentBlock[], incoming: ContentBlock): ContentBlock[] {
  const tail = blocks[blocks.length - 1];
  if (incoming.type === 'text' && tail?.type === 'text') {
    return [...blocks.slice(0, -1), { ...tail, text: tail.text + incoming.text }];
  }
  return [...blocks, incoming];
}

/** `undefined` = leave unchanged, `null` = clear, value = replace — the wire patch grammar, applied generically. */
function patchField<T>(current: T | undefined, incoming: T | null | undefined): T | undefined {
  if (incoming === undefined) return current;
  return incoming === null ? undefined : incoming;
}

export class AcpItemAccumulator {
  private readonly items = new Map<string, AccumulatedItem>();
  private readonly order: string[] = [];
  private turnState: AcpTurnState | null = null;
  private usage: UsageUpdate | null = null;

  get itemsInOrder(): AccumulatedItem[] {
    return this.order.map((id) => this.items.get(id)!);
  }

  get latestTurnState(): AcpTurnState | null {
    return this.turnState;
  }

  get latestUsage(): UsageUpdate | null {
    return this.usage;
  }

  reset(): void {
    this.items.clear();
    this.order.length = 0;
    this.turnState = null;
    this.usage = null;
  }

  apply(update: SessionUpdate): void {
    switch (update.sessionUpdate) {
      case 'user_message_chunk':
        this.applyChunk(update.messageId, 'user', false, update.content, update._meta);
        return;
      case 'agent_message_chunk':
        this.applyChunk(update.messageId, 'agent', false, update.content, update._meta);
        return;
      case 'agent_thought_chunk':
        this.applyChunk(update.messageId, 'agent', true, update.content, update._meta);
        return;
      case 'user_message':
        this.applyUpsert(update.messageId, 'user', false, update.content, update._meta);
        return;
      case 'agent_message':
        this.applyUpsert(update.messageId, 'agent', false, update.content, update._meta);
        return;
      case 'agent_thought':
        this.applyUpsert(update.messageId, 'agent', true, update.content, update._meta);
        return;
      case 'tool_call_update':
        this.applyToolCallUpdate(update);
        return;
      case 'tool_call_content_chunk':
        this.applyToolCallContentChunk(update.toolCallId, update.content);
        return;
      case 'state_update':
        this.turnState = update;
        return;
      case 'usage_update':
        this.usage = update;
        return;
    }
  }

  private ensureOrdered(id: string): void {
    if (!this.items.has(id)) this.order.push(id);
  }

  private applyChunk(
    id: string,
    role: AccumulatedItemRole,
    isThought: boolean,
    content: ContentBlock,
    meta: Record<string, unknown> | null | undefined,
  ): void {
    this.ensureOrdered(id);
    const prior = this.items.get(id);
    const priorContent = prior && prior.kind !== 'tool-call' ? prior.content : [];
    const priorMeta = prior && prior.kind !== 'tool-call' ? prior.meta : undefined;
    const blocks = appendBlock(priorContent, content);
    const item: AccumulatedMessageItem | AccumulatedThoughtItem = isThought
      ? { kind: 'thought', id, content: blocks, meta: patchField(priorMeta, meta) }
      : { kind: 'message', id, role, content: blocks, meta: patchField(priorMeta, meta) };
    this.items.set(id, item);
  }

  private applyUpsert(
    id: string,
    role: AccumulatedItemRole,
    isThought: boolean,
    content: ContentBlock[] | null | undefined,
    meta: Record<string, unknown> | null | undefined,
  ): void {
    this.ensureOrdered(id);
    const prior = this.items.get(id);
    const priorContent = prior && prior.kind !== 'tool-call' ? prior.content : [];
    const priorMeta = prior && prior.kind !== 'tool-call' ? prior.meta : undefined;
    const blocks = content === undefined ? priorContent : (content ?? []);
    const item: AccumulatedMessageItem | AccumulatedThoughtItem = isThought
      ? { kind: 'thought', id, content: blocks, meta: patchField(priorMeta, meta) }
      : { kind: 'message', id, role, content: blocks, meta: patchField(priorMeta, meta) };
    this.items.set(id, item);
  }

  private applyToolCallUpdate(update: Extract<SessionUpdate, { sessionUpdate: 'tool_call_update' }>): void {
    const id = update.toolCallId;
    this.ensureOrdered(id);
    const prior = this.items.get(id);
    const priorToolCall = prior?.kind === 'tool-call' ? prior : undefined;
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
    };
    this.items.set(id, item);
  }

  private applyToolCallContentChunk(id: string, content: ToolCallContent): void {
    this.ensureOrdered(id);
    const prior = this.items.get(id);
    const priorToolCall = prior?.kind === 'tool-call' ? prior : undefined;
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
    };
    this.items.set(id, item);
  }
}
