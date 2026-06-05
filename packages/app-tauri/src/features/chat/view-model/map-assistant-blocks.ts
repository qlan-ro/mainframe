/**
 * Shared recursive DisplayContent → native content-part mapper.
 *
 * `mapAssistantBlocks` runs at BOTH the top-level assistant message AND inside a
 * subagent transcript (`task_group.calls`). That single recursion IS the WS14c
 * invariant in native form: a `tool_group` / `task_progress` nested in a
 * subagent is flattened/encoded exactly as at the top level. Each call scopes
 * its own `toolCallId` dedup (assistant-ui crashes on a duplicate part key).
 *
 * Go-native projection (replaces the synthetic `_ToolGroup`/`_TaskGroup`):
 *  - `tool_group`     → flat native `tool-call` parts. Their server-decided
 *                       group membership is recorded in `groups` (toolCallId →
 *                       groupId) so the client `groupBy` echoes the DAEMON's
 *                       grouping instead of re-deriving it from tool names.
 *  - `task_group`     → ONE `Task` `tool-call` carrying `messages` (the subagent
 *                       transcript as a real readonly thread).
 *  - `task_progress`  → ONE `_TaskProgress` card part · `skill_loaded` → `_SkillLoaded`.
 *  - `image`          → native `{type:'image', image: data-URL}` part.
 */
import { ExportedMessageRepository } from '@assistant-ui/react';
import type { ThreadMessage, ThreadMessageLike } from '@assistant-ui/react';
import type { DisplayContent } from '@qlan-ro/mainframe-types';
import { mapToolCallPart, mapToolResult } from './map-tool-result';

type ContentPart = Exclude<ThreadMessageLike['content'], string>[number];
type ReadonlyJSONObject = import('assistant-stream/utils').ReadonlyJSONObject;
type TaskGroupBlock = DisplayContent & { type: 'task_group' };

/** Null-byte prefix prevents collision with real user content. */
export const PERMISSION_PLACEHOLDER = Object.freeze({
  type: 'text' as const,
  text: '\0__MF_PERMISSION__',
});

/** Where the daemon's per-tool group membership rides to the client groupBy. */
export interface MainframeMessageMeta {
  readonly partGroups: Readonly<Record<string, string>>;
}

export interface MappedAssistantBlocks {
  readonly parts: ContentPart[];
  /** toolCallId → daemon groupId, only for tools the daemon grouped. */
  readonly groups: Record<string, string>;
}

/** Guarantees ≥1 content part so assistant-ui never receives an empty array. */
function ensureNonEmpty(parts: ContentPart[]): ContentPart[] {
  return parts.length > 0 ? parts : [{ type: 'text', text: '' }];
}

export function mapAssistantBlocks(blocks: DisplayContent[]): MappedAssistantBlocks {
  const parts: ContentPart[] = [];
  const groups: Record<string, string> = {};
  const seen = new Set<string>();
  const uniqueId = (id: string): string => {
    const base = id.length > 0 ? id : `idx-${parts.length}`;
    if (!seen.has(base)) {
      seen.add(base);
      return base;
    }
    const suffixed = `${base}-${parts.length}`;
    seen.add(suffixed);
    return suffixed;
  };

  for (const block of blocks) {
    switch (block.type) {
      case 'text':
        parts.push({ type: 'text', text: block.text });
        break;

      case 'thinking':
        parts.push({ type: 'reasoning', text: block.thinking });
        break;

      case 'image':
        parts.push({ type: 'image', image: `data:${block.mediaType};base64,${block.data}` });
        break;

      case 'skill_loaded':
        parts.push({
          type: 'tool-call',
          toolCallId: uniqueId(`skill:${block.skillName}`),
          toolName: '_SkillLoaded',
          args: {
            skillName: block.skillName,
            path: block.path,
            content: block.content,
          } as unknown as ReadonlyJSONObject,
          result: 'loaded',
        });
        break;

      case 'tool_call':
        if (block.category !== 'hidden') {
          parts.push(mapToolCallPart(block, uniqueId(block.id)));
        }
        break;

      case 'tool_group': {
        // Flatten to native tool-calls; record the daemon's group membership so
        // groupBy reconstructs THIS group (not a name-derived approximation).
        const memberIds: string[] = [];
        for (const call of block.calls) {
          if (call.type === 'tool_call' && call.category !== 'hidden') {
            const id = uniqueId(call.id);
            parts.push(mapToolCallPart(call, id));
            memberIds.push(id);
          }
        }
        if (memberIds.length > 0) {
          const groupId = memberIds[0]!;
          for (const id of memberIds) groups[id] = groupId;
        }
        break;
      }

      case 'task_group':
        parts.push(mapTaskGroupPart(block, uniqueId(block.agentId)));
        break;

      case 'task_progress':
        parts.push({
          type: 'tool-call',
          toolCallId: uniqueId(block.items[0]?.id ?? ''),
          toolName: '_TaskProgress',
          args: {
            items: block.items.map((item) => ({
              toolCallId: item.id,
              toolName: item.name,
              args: item.input,
              result: item.result,
              isError: item.result?.isError,
            })),
          } as unknown as ReadonlyJSONObject,
          result: 'accumulated',
        });
        break;

      case 'error':
        parts.push({ type: 'text', text: block.message });
        break;

      case 'permission_request':
        parts.push(PERMISSION_PLACEHOLDER);
        break;

      // 'compaction' — system-level marker, not rendered as an assistant part.
    }
  }

  return { parts, groups };
}

/** `task_group` → a `Task` tool-call part carrying the subagent transcript. */
function mapTaskGroupPart(block: TaskGroupBlock, toolCallId: string): ContentPart {
  return {
    type: 'tool-call',
    toolCallId,
    toolName: 'Task',
    args: { ...(block.taskArgs ?? {}) } as unknown as ReadonlyJSONObject,
    result: mapToolResult(block.result, 'Task'),
    isError: block.result?.isError,
    messages: projectSubagentMessages(block),
  };
}

/**
 * Project a subagent's `task_group.calls` into real `ThreadMessage`s for the
 * native readonly-thread renderer. The prompt (if any) becomes a leading user
 * turn; the agent's work an assistant turn whose metadata carries its OWN group
 * membership (so nested explore tools group correctly inside the transcript).
 */
export function projectSubagentMessages(block: TaskGroupBlock): ThreadMessage[] {
  const likes: ThreadMessageLike[] = [];
  const prompt = typeof block.taskArgs?.['prompt'] === 'string' ? (block.taskArgs['prompt'] as string) : undefined;

  if (prompt) {
    likes.push({ role: 'user', id: `${block.agentId}:prompt`, content: [{ type: 'text', text: prompt }] });
  }

  const { parts, groups } = mapAssistantBlocks(block.calls);
  likes.push({
    role: 'assistant',
    id: `${block.agentId}:transcript`,
    content: ensureNonEmpty(parts),
    ...(Object.keys(groups).length > 0 && { metadata: { custom: { mainframe: { partGroups: groups } } } }),
  });

  return ExportedMessageRepository.fromArray(likes).messages.map((m) => m.message);
}
