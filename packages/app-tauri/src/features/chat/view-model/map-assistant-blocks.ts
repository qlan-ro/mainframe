/**
 * Shared recursive DisplayContent → native content-part mapper.
 *
 * `mapAssistantBlocks` runs at BOTH the top-level assistant message AND inside a
 * subagent transcript (`task_group.calls`). That single recursion IS the WS14c
 * invariant in native form: a `tool_group` / `task_progress` nested in a
 * subagent is flattened/encoded exactly as at the top level.
 *
 * Go-native projection (replaces the synthetic `_ToolGroup`/`_TaskGroup`):
 *  - `tool_group`     → flat native `tool-call` parts; their server-decided group
 *                       membership (toolCallId→groupId) + the derived header
 *                       summary are recorded so the client groupBy/ToolGroup
 *                       echo the daemon instead of re-deriving at render time.
 *  - `task_group`     → ONE `Task` `tool-call` carrying native `messages`.
 *  - `task_progress`  → ONE `_TaskProgress` card part · `image` → native image.
 *
 * (skill_loaded is NOT handled here — the daemon only emits it on system
 * messages, where SystemMessage renders the rich SkillLoadedCard.)
 */
import { ExportedMessageRepository } from '@assistant-ui/react';
import type { ThreadMessage, ThreadMessageLike } from '@assistant-ui/react';
import type { DisplayContent } from '@qlan-ro/mainframe-types';
import { mapToolCallPart, mapToolResult } from './map-tool-result';
import { type ContentPart, ensureNonEmpty, toJsonArgs } from './content';
import type { TaskProgressArgs } from './message-meta';
import { toolGroupSummary } from './tool-group-summary';

type TaskGroupBlock = DisplayContent & { type: 'task_group' };

/** Null-byte prefix prevents collision with real user content. */
export const PERMISSION_PLACEHOLDER = Object.freeze({
  type: 'text' as const,
  text: '\0__MF_PERMISSION__',
});

export interface MappedAssistantBlocks {
  readonly parts: ContentPart[];
  /** toolCallId → daemon groupId (only for tools the daemon grouped). */
  readonly groups: Record<string, string>;
  /** groupId → derived header summary (e.g. "Read 3 files · Searched 2 patterns"). */
  readonly summaries: Record<string, string>;
}

export function mapAssistantBlocks(blocks: DisplayContent[]): MappedAssistantBlocks {
  const parts: ContentPart[] = [];
  const groups: Record<string, string> = {};
  const summaries: Record<string, string> = {};
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

      case 'tool_call':
        if (block.category !== 'hidden') {
          parts.push(mapToolCallPart(block, uniqueId(block.id)));
        }
        break;

      case 'tool_group': {
        // Flatten to native tool-calls; record the daemon's group membership +
        // the derived summary so groupBy/ToolGroup reconstruct THIS group.
        const memberIds: string[] = [];
        const memberNames: { toolName: string }[] = [];
        for (const call of block.calls) {
          if (call.type === 'tool_call' && call.category !== 'hidden') {
            const id = uniqueId(call.id);
            parts.push(mapToolCallPart(call, id));
            memberIds.push(id);
            memberNames.push({ toolName: call.name });
          }
        }
        if (memberIds.length > 0) {
          const groupId = memberIds[0]!;
          for (const id of memberIds) groups[id] = groupId;
          summaries[groupId] = toolGroupSummary(memberNames);
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
          args: toJsonArgs<TaskProgressArgs>({
            items: block.items.map((item) => ({
              toolCallId: item.id,
              toolName: item.name,
              args: item.input,
              result: item.result,
              isError: item.result?.isError,
            })),
          }),
          result: 'accumulated',
        });
        break;

      case 'error':
        parts.push({ type: 'text', text: block.message });
        break;

      case 'permission_request':
        parts.push(PERMISSION_PLACEHOLDER);
        break;

      // 'skill_loaded' / 'compaction' — system-level, not assistant parts.
    }
  }

  return { parts, groups, summaries };
}

/** `task_group` → a `Task` tool-call part carrying the subagent transcript. */
function mapTaskGroupPart(block: TaskGroupBlock, toolCallId: string): ContentPart {
  return {
    type: 'tool-call',
    toolCallId,
    toolName: 'Task',
    args: toJsonArgs({ ...(block.taskArgs ?? {}) }),
    result: mapToolResult(block.result, 'Task'),
    isError: block.result?.isError,
    messages: projectSubagentMessages(block),
  };
}

/**
 * Project a subagent's `task_group.calls` into real `ThreadMessage`s for the
 * native readonly-thread renderer. The prompt (if any) becomes a leading user
 * turn; the agent's work an assistant turn whose metadata carries its OWN group
 * membership + summaries (so nested explore tools group inside the transcript).
 */
export function projectSubagentMessages(block: TaskGroupBlock): ThreadMessage[] {
  const likes: ThreadMessageLike[] = [];
  const prompt = typeof block.taskArgs?.['prompt'] === 'string' ? (block.taskArgs['prompt'] as string) : undefined;

  if (prompt) {
    likes.push({ role: 'user', id: `${block.agentId}:prompt`, content: [{ type: 'text', text: prompt }] });
  }

  const { parts, groups, summaries } = mapAssistantBlocks(block.calls);
  const mainframe = buildAssistantMainframeMeta(groups, summaries);
  likes.push({
    role: 'assistant',
    id: `${block.agentId}:transcript`,
    content: ensureNonEmpty(parts),
    ...(mainframe && { metadata: { custom: { mainframe } } }),
  });

  return ExportedMessageRepository.fromArray(likes).messages.map((m) => m.message);
}

/** The assistant-side mainframe metadata payload, or undefined when empty. */
export function buildAssistantMainframeMeta(
  groups: Record<string, string>,
  summaries: Record<string, string>,
): { partGroups: Record<string, string>; groupSummaries: Record<string, string> } | undefined {
  return Object.keys(groups).length > 0 ? { partGroups: groups, groupSummaries: summaries } : undefined;
}
