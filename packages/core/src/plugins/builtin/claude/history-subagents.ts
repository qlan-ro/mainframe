import { nanoid } from 'nanoid';
import type { ChatMessage, MessageContent } from '@qlan-ro/mainframe-types';
import { buildToolResultBlocks } from './history-tool-result.js';

/**
 * Flatten a subagent assistant message's content (tool_use / text / thinking)
 * onto the accumulated child-block list keyed by parentId. Shared by the two
 * collection paths (live `data.message` progress entries and subagent JSONL
 * assistant entries), which derive parentId/content differently but append the
 * blocks identically.
 */
export function appendAssistantBlocks(
  parentId: string,
  content: Array<Record<string, unknown>>,
  agentTools: Map<string, MessageContent[]>,
): void {
  const existing = agentTools.get(parentId) ?? [];
  for (const block of content) {
    if (block.type === 'tool_use') {
      existing.push({
        type: 'tool_use',
        id: (block.id as string) || nanoid(),
        name: block.name as string,
        input: (block.input as Record<string, unknown>) ?? {},
        parentToolUseId: parentId,
      });
    } else if (block.type === 'text') {
      const text = (block.text as string) || '';
      if (text.trim()) existing.push({ type: 'text', text, parentToolUseId: parentId });
    } else if (block.type === 'thinking') {
      const t = (block.thinking as string) || '';
      if (t.trim()) existing.push({ type: 'thinking', thinking: t, parentToolUseId: parentId });
    }
  }
  if (existing.length > 0) agentTools.set(parentId, existing);
}

export function collectAgentProgressTools(
  entry: Record<string, unknown>,
  agentTools: Map<string, MessageContent[]>,
): void {
  const parentId = entry.parentToolUseID as string | undefined;
  if (!parentId) return;
  const data = entry.data as Record<string, unknown>;
  const msg = data.message as Record<string, unknown> | undefined;
  const inner = msg?.message as Record<string, unknown> | undefined;
  if (!inner || inner.role !== 'assistant') return;
  const content = inner.content as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(content)) return;

  appendAssistantBlocks(parentId, content, agentTools);
}

/** Extract tool_result blocks from subagent JSONL user entries. */
export function collectSubagentToolResults(
  entry: Record<string, unknown>,
  results: Map<string, MessageContent & { type: 'tool_result' }>,
): void {
  if (entry.type !== 'user') return;
  const message = entry.message as Record<string, unknown> | undefined;
  if (!message) return;
  const rawContent = message.content;
  if (!Array.isArray(rawContent)) return;
  const toolUseResult = entry.toolUseResult as Record<string, unknown> | undefined;
  const blocks = buildToolResultBlocks(message, toolUseResult);
  for (const block of blocks) {
    if (block.type === 'tool_result') {
      results.set(block.toolUseId, block);
    }
  }
}

/**
 * Capture the agentId → parent tool_use_id mapping from a parent-JSONL user
 * entry whose tool_result corresponds to a Task/Agent dispatch. CLI 2.1.118+
 * does not write parentToolUseID into subagent JSONL entries; this map is the
 * only way to link a subagent's blocks back to its dispatching tool_use.
 */
export function captureAgentIdMapping(entry: Record<string, unknown>, map: Map<string, string>): void {
  if (entry.type !== 'user') return;
  const tur = (entry.toolUseResult ?? entry.tool_use_result) as Record<string, unknown> | undefined;
  const agentId = typeof tur?.agentId === 'string' ? (tur.agentId as string) : undefined;
  if (!agentId) return;
  const message = entry.message as { content?: unknown } | undefined;
  const content = message?.content;
  if (!Array.isArray(content)) return;
  for (const block of content as Array<Record<string, unknown>>) {
    if (block.type === 'tool_result' && typeof block.tool_use_id === 'string') {
      map.set(agentId, block.tool_use_id);
      return;
    }
  }
}

/** Collect assistant text/thinking/tool_use blocks from subagent JSONL assistant entries. */
export function collectSubagentAssistantBlocks(
  entry: Record<string, unknown>,
  agentTools: Map<string, MessageContent[]>,
  agentIdMap?: Map<string, string>,
): void {
  let parentId = entry.parentToolUseID as string | undefined;
  if (!parentId && agentIdMap) {
    const agentId = entry.agentId as string | undefined;
    if (agentId) parentId = agentIdMap.get(agentId);
  }
  if (!parentId) return;
  if (entry.type !== 'assistant') return;
  const message = entry.message as Record<string, unknown> | undefined;
  const content = message?.content as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(content)) return;

  appendAssistantBlocks(parentId, content, agentTools);
}

/** Inject subagent tool_result blocks after their matching tool_use in assistant messages. */
export function attachSubagentToolResults(
  messages: ChatMessage[],
  results: Map<string, MessageContent & { type: 'tool_result' }>,
): void {
  for (const msg of messages) {
    if (msg.type !== 'assistant') continue;
    const newContent: MessageContent[] = [];
    for (const block of msg.content) {
      newContent.push(block);
      if (block.type === 'tool_use') {
        const toolResult = results.get(block.id);
        if (toolResult) newContent.push({ ...toolResult, parentToolUseId: block.parentToolUseId });
      }
    }
    msg.content = newContent;
  }
}

export function injectAgentChildren(messages: ChatMessage[], agentTools: Map<string, MessageContent[]>): void {
  for (const msg of messages) {
    if (msg.type !== 'assistant') continue;
    const newContent: MessageContent[] = [];
    for (const block of msg.content) {
      newContent.push(block);
      if (block.type === 'tool_use' && (block.name === 'Agent' || block.name === 'Task')) {
        const children = agentTools.get(block.id);
        if (children) newContent.push(...children);
      }
    }
    msg.content = newContent;
  }
}
