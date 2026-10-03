import type { ThreadMessageLike } from '@assistant-ui/react';
import { ExportedMessageRepository } from '@assistant-ui/react';
import { MAINFRAME_META_NAMESPACE, type ItemMeta } from '@qlan-ro/mainframe-types';
import type { ContentBlock } from '@qlan-ro/mainframe-types';
import type { AccumulatedItem } from './acp-item-accumulator';
import { type ContentPart, ensureNonEmpty, toJsonArgs } from './content';
import { convertUserContainer } from './convert-acp-user';
import type { MainframeMessageMeta } from './message-meta';
import { parseItemMeta } from './parse-item-meta';
import { toolCallResult } from './tool-call-result';
import { mapPresentationSources } from './transcript-presentation';
import { projectToolLifecycle } from './tool-call-lifecycle';
import { toolGroupSummary, type ToolGroupSummaryItem } from './tool-group-summary';

interface ParsedItem {
  readonly item: AccumulatedItem;
  readonly meta: ItemMeta;
}

/** A text/reasoning part's `MessagePartStreamStatus` — undefined means "no opinion" (today's last-part fallback for Codex and pre-partials Claude). */
type PartStreamStatus = { type: 'running' } | { type: 'complete' };

/**
 * D6: `streaming === true` (the item the partial overlay currently backs)
 * always wins and marks the part `running` — including for a replay-origin
 * item, which happens when a mid-turn full replay's overlay text joins a
 * segment that replay just rebuilt (`Accum::claim` extends the tail
 * segment). Otherwise a replay-origin item's parts are `complete`, so the
 * "running, no tokens yet" fallback (`toMessagePartStatus`) never stamps a
 * replayed tail as running and retypes it. An item created live, not
 * streaming, carries no status at all.
 */
function partStatus(parsed: ParsedItem): PartStreamStatus | undefined {
  if (parsed.meta.streaming === true) return { type: 'running' };
  if (parsed.item.origin === 'replay') return { type: 'complete' };
  return undefined;
}

/**
 * Ordered blocks → aui parts: text renders as a text part, image as a native
 * image part carrying the same data URL the legacy converter built.
 */
function messageParts(content: readonly ContentBlock[], status: PartStreamStatus | undefined): ContentPart[] {
  return content.map((block) =>
    block.type === 'text'
      ? { type: 'text', text: block.text, ...(status && { status }) }
      : { type: 'image', image: `data:${block.mimeType};base64,${block.data}` },
  );
}

function textOf(content: readonly ContentBlock[]): string {
  return content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('');
}

type ChildrenMap = ReadonlyMap<string, readonly ParsedItem[]>;

function toolPart(parsed: ParsedItem, children: ChildrenMap): ContentPart {
  const item = parsed.item as Extract<AccumulatedItem, { kind: 'tool-call' }>;
  // Never the id as a name (D3): a missing title means the daemon hasn't
  // sent one yet, not that the id itself is presentable.
  const toolName = parsed.meta.subagent ? 'Task' : (item.title ?? 'Unknown tool');
  const lifecycle = projectToolLifecycle(item.status);
  return {
    type: 'tool-call',
    toolCallId: item.id,
    toolName,
    args: toJsonArgs((item.rawInput ?? {}) as object),
    result: toolCallResult(item),
    ...(parsed.meta.toolCallTiming ? { timing: parsed.meta.toolCallTiming } : {}),
    isError: item.status === 'failed' ? true : undefined,
    ...((lifecycle || parsed.meta.commandExecution) && {
      providerMetadata: {
        ...(lifecycle && { mainframe: lifecycle }),
        ...(parsed.meta.commandExecution && { codex: parsed.meta.commandExecution }),
      },
    }),
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
): {
  parts: ContentPart[];
  mainframe: Pick<MainframeMessageMeta, 'partGroups' | 'groupSummaries' | 'partSources'> | undefined;
  /** True when any part in this container is the one the overlay is currently streaming (D6) — the container's own `ThreadMessageLike.status`. */
  streaming: boolean;
} {
  const partSources = mapPresentationSources(items);
  const parts: ContentPart[] = [];
  const groups: Record<string, string> = {};
  const members: Record<string, ToolGroupSummaryItem[]> = {};
  let streaming = false;

  for (const parsed of items) {
    const { item } = parsed;
    if (item.kind === 'message') {
      const status = partStatus(parsed);
      if (status?.type === 'running') streaming = true;
      parts.push(...messageParts(item.content, status));
      continue;
    }
    if (item.kind === 'thought') {
      const status = partStatus(parsed);
      if (status?.type === 'running') streaming = true;
      parts.push({ type: 'reasoning', text: textOf(item.content), ...(status && { status }) });
      continue;
    }
    parts.push(toolPart(parsed, children));
    const groupId = parsed.meta.groupId;
    if (groupId) {
      groups[item.id] = groupId;
      (members[groupId] ??= []).push({ toolName: item.title ?? item.id });
    }
  }

  if (Object.keys(groups).length === 0)
    return { parts, mainframe: partSources ? { partSources } : undefined, streaming };
  const summaries = Object.fromEntries(
    Object.entries(members).map(([groupId, names]) => [groupId, toolGroupSummary(names)]),
  );
  return {
    parts,
    mainframe: { partGroups: groups, groupSummaries: summaries, ...(partSources && { partSources }) },
    streaming,
  };
}

function assistantContainer(
  items: readonly ParsedItem[],
  children: ChildrenMap,
  base: { id: string; createdAt: Date },
): ThreadMessageLike {
  const { parts, mainframe, streaming } = assistantParts(items, children);
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
    ...(streaming && { status: { type: 'running' } }),
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
  // A container can hold several message segments, so the marker is looked up
  // across all of them rather than on the first — an error container carries
  // no tool calls today and therefore never segments, but nothing here should
  // depend on that staying true.
  const messages = items.filter((p) => p.item.kind === 'message');
  const blocks = messages.flatMap((p) => (p.item.kind === 'message' ? p.item.content : []));
  const fallback = textOf(blocks).trim();
  const errorText =
    messages.find((p) => p.meta.errorText)?.meta.errorText ?? (fallback.length > 0 ? fallback : 'An error occurred');
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
    const parsed: ParsedItem = { item, meta: parseItemMeta(item, MAINFRAME_META_NAMESPACE) };
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
