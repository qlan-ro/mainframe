/**
 * `AccumulatedItem[]` → `ThreadMessageLike[]` — the ONE message converter
 * (desktop-cutover pass; the legacy `convert-message.ts` is deleted).
 *
 * Reaggregation: the encoder flattens each `DisplayMessage` into items that
 * all carry the container's id in `_meta["_mainframe.dev"].containerId`
 * (`ItemMeta`). This module folds them back into one aui message per
 * container — parts in item order, the daemon's tool-group membership echoed
 * as `partGroups`/`groupSummaries`, subagent transcripts rebuilt from the
 * `parentToolCallId` relation into a `Task` tool-call part carrying nested
 * `messages` — so the renderer (`AssistantMessage` GroupedParts, the tool
 * cards, `MessageTimestamp`) is byte-identical with what the legacy
 * projection produced.
 *
 * Legacy invariants preserved: per-container ≥1-content-part fallback,
 * capture-sentinel image routing + review comments (convert-acp-user.ts),
 * error containers rendering the styled error block, system containers
 * carrying skill/compaction meta. Id-keyed accumulation makes the legacy
 * per-message `uniqueId()` dedup structural: two parts can never share an id
 * because two items cannot.
 */
import type { ThreadMessageLike } from '@assistant-ui/react';
import { ExportedMessageRepository } from '@assistant-ui/react';
import {
  ItemMetaSchema,
  MAINFRAME_META_NAMESPACE,
  StructuredDiffSchema,
  TruncationMarkerSchema,
  type ItemMeta,
} from '@qlan-ro/mainframe-types';
import type { ContentBlock } from '@qlan-ro/mainframe-types';
import type { AccumulatedItem } from './acp-item-accumulator';
import { type ContentPart, ensureNonEmpty, toJsonArgs } from './content';
import { convertUserContainer } from './convert-acp-user';
import type { MainframeMessageMeta } from './message-meta';
import { toolGroupSummary, type ToolGroupSummaryItem } from './tool-group-summary';

interface ParsedItem {
  readonly item: AccumulatedItem;
  readonly meta: ItemMeta;
}

function parseMeta(item: AccumulatedItem): ItemMeta {
  const parsed = ItemMetaSchema.safeParse(item.meta?.[MAINFRAME_META_NAMESPACE]);
  return parsed.success ? parsed.data : {};
}

/**
 * Rebuild the legacy `mapToolResult` shape from the item's content entries:
 * `content` blocks join into the result text; a text block's namespaced meta
 * restores the `truncated`/`fullBytes` pair (spec Decision 20) and the
 * AskUserQuestion answers; a `diff` entry's fidelity payload (spec Decision
 * 15) contributes the structured hunks and before/after file text the
 * Edit/Write cards consume.
 */
function toolCallResult(item: Extract<AccumulatedItem, { kind: 'tool-call' }>): unknown {
  if (item.content.length === 0) return undefined;
  const textBlocks = item.content.flatMap((entry) =>
    entry.type === 'content' && entry.content.type === 'text' ? [entry.content] : [],
  );
  const text = textBlocks.map((block) => block.text).join('');
  const blockMetas = textBlocks.map((block) => block._meta?.[MAINFRAME_META_NAMESPACE]);
  const truncation = blockMetas.flatMap((meta) => {
    const parsed = TruncationMarkerSchema.safeParse(meta);
    return parsed.success && parsed.data.truncated ? [parsed.data] : [];
  })[0];
  const askUserQuestion = blockMetas.flatMap((meta) => {
    const answers = (meta as { askUserQuestion?: unknown } | undefined)?.askUserQuestion;
    return Array.isArray(answers) ? [answers] : [];
  })[0];
  const diff = item.content.find((entry) => entry.type === 'diff');
  const fidelity = diff ? StructuredDiffSchema.safeParse(diff._meta?.[MAINFRAME_META_NAMESPACE]) : undefined;
  if (fidelity?.success) {
    return {
      content: text,
      structuredPatch: fidelity.data.structuredPatch,
      originalFile: fidelity.data.originalFile,
      modifiedFile: fidelity.data.modifiedFile,
      ...(truncation ? { truncated: true, fullBytes: truncation.fullBytes } : {}),
    };
  }
  if (truncation) return { content: text, truncated: true as const, fullBytes: truncation.fullBytes };
  if (askUserQuestion) return { content: text, askUserQuestion };
  return text;
}

/**
 * Ordered blocks → aui parts: text renders as a text part, image as a native
 * image part carrying the same data URL the legacy converter built.
 */
function messageParts(content: readonly ContentBlock[]): ContentPart[] {
  return content.map((block) =>
    block.type === 'text'
      ? { type: 'text', text: block.text }
      : { type: 'image', image: `data:${block.mimeType};base64,${block.data}` },
  );
}

function textOf(content: readonly ContentBlock[]): string {
  return content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('');
}

type ChildrenMap = ReadonlyMap<string, readonly ParsedItem[]>;

function toolPart(parsed: ParsedItem, children: ChildrenMap): ContentPart {
  const item = parsed.item as Extract<AccumulatedItem, { kind: 'tool-call' }>;
  const toolName = parsed.meta.subagent ? 'Task' : (item.title ?? item.id);
  return {
    type: 'tool-call',
    toolCallId: item.id,
    toolName,
    args: toJsonArgs((item.rawInput ?? {}) as object),
    result: toolCallResult(item),
    isError: item.status === 'failed' ? true : undefined,
    ...(parsed.meta.subagent ? { messages: subagentMessages(item, children) } : {}),
  };
}

/**
 * Rebuild a subagent transcript from the flat parent relation: the Task's
 * `prompt` arg becomes a leading user turn; the child items (message,
 * thought, tool calls — recursively including nested Tasks) become one
 * assistant turn whose metadata carries its own group membership, exactly
 * the shape the legacy `projectSubagentMessages` produced for the native
 * readonly-thread renderer.
 */
function subagentMessages(task: Extract<AccumulatedItem, { kind: 'tool-call' }>, children: ChildrenMap) {
  const likes: ThreadMessageLike[] = [];
  const input = (task.rawInput ?? {}) as Record<string, unknown>;
  const prompt = typeof input.prompt === 'string' ? input.prompt : undefined;
  if (prompt) {
    likes.push({ role: 'user', id: `${task.id}:prompt`, content: [{ type: 'text', text: prompt }] });
  }

  const { parts, mainframe } = assistantParts(children.get(task.id) ?? [], children);
  likes.push({
    role: 'assistant',
    id: `${task.id}:transcript`,
    content: ensureNonEmpty(parts),
    ...(mainframe && { metadata: { custom: { mainframe } } }),
  });
  return ExportedMessageRepository.fromArray(likes).messages.map((m) => m.message);
}

/** Items → parts in item order, plus the echoed tool-group membership meta. */
function assistantParts(
  items: readonly ParsedItem[],
  children: ChildrenMap,
): { parts: ContentPart[]; mainframe: Pick<MainframeMessageMeta, 'partGroups' | 'groupSummaries'> | undefined } {
  const parts: ContentPart[] = [];
  const groups: Record<string, string> = {};
  const members: Record<string, ToolGroupSummaryItem[]> = {};

  for (const parsed of items) {
    const { item } = parsed;
    if (item.kind === 'message') {
      parts.push(...messageParts(item.content));
      continue;
    }
    if (item.kind === 'thought') {
      parts.push({ type: 'reasoning', text: textOf(item.content) });
      continue;
    }
    parts.push(toolPart(parsed, children));
    const groupId = parsed.meta.groupId;
    if (groupId) {
      groups[item.id] = groupId;
      (members[groupId] ??= []).push({ toolName: item.title ?? item.id });
    }
  }

  if (Object.keys(groups).length === 0) return { parts, mainframe: undefined };
  const summaries = Object.fromEntries(
    Object.entries(members).map(([groupId, names]) => [groupId, toolGroupSummary(names)]),
  );
  return { parts, mainframe: { partGroups: groups, groupSummaries: summaries } };
}

function assistantContainer(
  items: readonly ParsedItem[],
  children: ChildrenMap,
  base: { id: string; createdAt: Date },
): ThreadMessageLike {
  const { parts, mainframe } = assistantParts(items, children);
  const messageMeta = items.find((p) => p.meta.messageMeta)?.meta.messageMeta;
  const costUsd = typeof messageMeta?.cost_usd === 'number' ? messageMeta.cost_usd : undefined;
  const turnMs = typeof messageMeta?.turnDurationMs === 'number' ? messageMeta.turnDurationMs : undefined;

  const mf: MainframeMessageMeta = {
    ...mainframe,
    ...(costUsd !== undefined && { cost: costUsd }),
  };
  const timing =
    turnMs !== undefined
      ? { timing: { streamStartTime: 0, totalStreamTime: turnMs, totalChunks: 0, toolCallCount: 0 } as const }
      : {};
  const hasMeta = Object.keys(mf).length > 0 || turnMs !== undefined;

  return {
    role: 'assistant',
    content: ensureNonEmpty(parts),
    ...base,
    ...(hasMeta && { metadata: { ...timing, custom: { mainframe: mf } } }),
  };
}

function systemContainer(items: readonly ParsedItem[], base: { id: string; createdAt: Date }): ThreadMessageLike {
  const message = items.find((p) => p.item.kind === 'message');
  const blocks = message && message.item.kind !== 'tool-call' ? message.item.content : [];
  const textParts: ContentPart[] = blocks.flatMap((block) =>
    block.type === 'text' && block.text ? [{ type: 'text', text: block.text } as ContentPart] : [],
  );
  const mf: MainframeMessageMeta = {
    ...(message?.meta.isCompacted && { isCompacted: true }),
    ...(message?.meta.skillLoaded && { skillLoaded: message.meta.skillLoaded }),
  };
  return {
    role: 'system',
    content: ensureNonEmpty(textParts),
    ...base,
    ...(Object.keys(mf).length > 0 && { metadata: { custom: { mainframe: mf } } }),
  };
}

function errorContainer(items: readonly ParsedItem[], base: { id: string; createdAt: Date }): ThreadMessageLike {
  const message = items.find((p) => p.item.kind === 'message');
  const blocks = message && message.item.kind !== 'tool-call' ? message.item.content : [];
  const fallback = textOf(blocks).trim();
  const errorText = message?.meta.errorText ?? (fallback.length > 0 ? fallback : 'An error occurred');
  // Keep the text part (≥1-content-part invariant + a11y/fallback); the
  // `errorText` meta drives AssistantMessage's styled error block.
  return {
    role: 'assistant',
    content: [{ type: 'text', text: errorText }],
    ...base,
    metadata: { custom: { mainframe: { errorText } satisfies MainframeMessageMeta } },
  };
}

function convertContainer(
  containerId: string,
  items: readonly ParsedItem[],
  children: ChildrenMap,
  createdAtFor: (id: string) => Date,
): ThreadMessageLike {
  const first = items[0]!;
  const timestamp = items.find((p) => p.meta.timestamp)?.meta.timestamp;
  const base = {
    id: containerId,
    createdAt: timestamp ? new Date(timestamp) : createdAtFor(first.item.id),
  };
  const message = items.find((p) => p.item.kind === 'message');

  if (message?.meta.kind === 'system') return systemContainer(items, base);
  if (message?.meta.kind === 'error') return errorContainer(items, base);
  if (message?.item.kind === 'message' && message.item.role === 'user') {
    return convertUserContainer(message.item.content, message.meta.messageMeta, base);
  }
  return assistantContainer(items, children, base);
}

export function convertAcpItems(
  items: readonly AccumulatedItem[],
  createdAtFor: (id: string) => Date,
): ThreadMessageLike[] {
  const children = new Map<string, ParsedItem[]>();
  const containers = new Map<string, ParsedItem[]>();

  for (const item of items) {
    const parsed: ParsedItem = { item, meta: parseMeta(item) };
    const parentId = parsed.meta.parentToolCallId;
    if (parentId !== undefined) {
      const list = children.get(parentId) ?? [];
      list.push(parsed);
      children.set(parentId, list);
      continue;
    }
    const containerId = parsed.meta.containerId ?? item.id;
    const list = containers.get(containerId) ?? [];
    list.push(parsed);
    containers.set(containerId, list);
  }

  return [...containers.entries()].map(([containerId, group]) =>
    convertContainer(containerId, group, children, createdAtFor),
  );
}
