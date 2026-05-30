import type { ThreadMessageLike } from '@assistant-ui/react';
import type { DisplayMessage, DisplayContent } from '@qlan-ro/mainframe-types';

// Mutable version of the content array element type (ThreadMessageLike['content'] is readonly)
type ContentPart = Exclude<ThreadMessageLike['content'], string>[number];

// Re-export for consumers that import from this module
export type { ToolGroupItem, TaskProgressItem, PartEntry } from '@qlan-ro/mainframe-core/messages';

// Sentinel placeholder for permission_request — rendered as null (no visible UI needed here).
// A null-byte prefix prevents collision with user content.
export const PERMISSION_PLACEHOLDER = Object.freeze({ type: 'text' as const, text: '\0__MF_PERMISSION__' });

function mapDisplayContentToToolCall(block: DisplayContent & { type: 'tool_call' }): ContentPart {
  const result = block.result
    ? block.result.structuredPatch
      ? {
          content: block.result.content,
          structuredPatch: block.result.structuredPatch,
          originalFile: block.result.originalFile,
          modifiedFile: block.result.modifiedFile,
          truncated: block.result.truncated,
          fullBytes: block.result.fullBytes,
        }
      : block.result.truncated
        ? { content: block.result.content, truncated: true as const, fullBytes: block.result.fullBytes ?? 0 }
        : block.name === 'AskUserQuestion'
          ? { content: block.result.content, askUserQuestion: block.result.askUserQuestion }
          : block.result.content
    : undefined;

  return {
    type: 'tool-call',
    toolCallId: block.id,
    toolName: block.name,
    args: block.input as import('assistant-stream/utils').ReadonlyJSONObject,
    result,
    isError: block.result?.isError,
  };
}

/**
 * Maps a single DisplayMessage → ThreadMessageLike for the external store runtime.
 * All transformation (grouping, tag stripping, metadata extraction) is done by the daemon pipeline.
 */
export function convertMessage(message: DisplayMessage): ThreadMessageLike {
  switch (message.type) {
    case 'user': {
      const parts: ContentPart[] = message.content
        .filter((c): c is DisplayContent & { type: 'text' } => c.type === 'text' && !!c.text)
        .map((c) => ({ type: 'text' as const, text: c.text }));

      return {
        role: 'user',
        content: parts.length > 0 ? parts : [{ type: 'text' as const, text: '' }],
        id: message.id,
        createdAt: new Date(message.timestamp),
      };
    }

    case 'system': {
      // Skill-loaded blocks are passed through message metadata so the SystemMessage
      // component can render a SkillLoadedCard rather than a plain text bubble.
      const skillBlock = message.content.find(
        (c): c is DisplayContent & { type: 'skill_loaded' } => c.type === 'skill_loaded',
      );
      const textParts = message.content
        .filter((c): c is DisplayContent & { type: 'text' } => c.type === 'text')
        .map((c) => ({ type: 'text' as const, text: c.text }));

      const meta: Record<string, unknown> = { ...(message.metadata ?? {}) };
      if (skillBlock) {
        meta.skillLoaded = { skillName: skillBlock.skillName, path: skillBlock.path, content: skillBlock.content };
      }

      return {
        role: 'system',
        content: textParts.length > 0 ? textParts : [{ type: 'text' as const, text: '' }],
        id: message.id,
        createdAt: new Date(message.timestamp),
        ...(Object.keys(meta).length > 0 && { metadata: meta }),
      };
    }

    case 'assistant': {
      const parts: ContentPart[] = [];
      // assistant-ui keys each tool part by `toolCallId-<id>` and crashes the
      // message with "Duplicate key" if two parts collide. Upstream we already
      // emit unique ids, but a single defensive pass here keeps the renderer
      // safe against any future regression (empty fallback ids, repeated
      // agentIds, etc.). Suffix collisions with the part index so both parts
      // still render.
      const seenIds = new Set<string>();
      const uniqueId = (id: string, idx: number): string => {
        const candidate = id.length > 0 ? id : `idx-${idx}`;
        if (!seenIds.has(candidate)) {
          seenIds.add(candidate);
          return candidate;
        }
        const suffixed = `${candidate}-${idx}`;
        seenIds.add(suffixed);
        return suffixed;
      };

      for (const block of message.content) {
        switch (block.type) {
          case 'text':
            parts.push({ type: 'text', text: block.text });
            break;
          case 'thinking':
            parts.push({ type: 'reasoning' as const, text: block.thinking });
            break;
          case 'image':
            // Images in user messages are handled by UserMessage component; skip here
            break;
          case 'tool_call':
            if (block.category !== 'hidden') {
              const mapped = mapDisplayContentToToolCall(block);
              if (mapped.type === 'tool-call') {
                parts.push({ ...mapped, toolCallId: uniqueId(block.id, parts.length) });
              } else {
                parts.push(mapped);
              }
            }
            break;
          // tool_group and task_group inner calls are not filtered here — hidden
          // tools should not appear in pre-grouped output; if they do, that is a
          // daemon pipeline bug.
          case 'tool_group': {
            const calls = block.calls.filter(
              (c): c is DisplayContent & { type: 'tool_call' } => c.type === 'tool_call',
            );
            parts.push({
              type: 'tool-call',
              toolCallId: uniqueId(calls[0]?.id ?? '', parts.length),
              toolName: '_ToolGroup',
              args: {
                items: calls.map((c) => ({
                  toolCallId: c.id,
                  toolName: c.name,
                  args: c.input,
                  result: c.result,
                  isError: c.result?.isError,
                })),
              } as unknown as import('assistant-stream/utils').ReadonlyJSONObject,
              result: 'grouped',
            });
            break;
          }
          case 'task_group': {
            const children = block.calls
              .map((c) => {
                if (c.type === 'tool_call') {
                  return {
                    kind: 'tool' as const,
                    toolCallId: c.id,
                    toolName: c.name,
                    args: c.input,
                    result: c.result,
                    isError: c.result?.isError,
                  };
                }
                if (c.type === 'text') return { kind: 'text' as const, text: c.text };
                if (c.type === 'thinking') return { kind: 'thinking' as const, thinking: c.thinking };
                if (c.type === 'skill_loaded') {
                  return { kind: 'skill_loaded' as const, skillName: c.skillName, path: c.path, content: c.content };
                }
                if (c.type === 'image') return { kind: 'image' as const, mediaType: c.mediaType, data: c.data };
                return null;
              })
              .filter((x): x is NonNullable<typeof x> => x !== null);

            // Preserve the historical fallback that the agent's outer tool_result lives on the
            // first tool child (when block.result is missing). Only consider tool children here.
            const firstTool = children.find((c) => c.kind === 'tool') as { kind: 'tool'; result: unknown } | undefined;
            parts.push({
              type: 'tool-call',
              toolCallId: uniqueId(block.agentId, parts.length),
              toolName: '_TaskGroup',
              args: {
                taskArgs: block.taskArgs,
                children,
              } as unknown as import('assistant-stream/utils').ReadonlyJSONObject,
              result: block.result ?? firstTool?.result,
            });
            break;
          }
          case 'error':
            // Carry the message text directly so the renderer can display it without
            // a sentinel round-trip or cross-message scan. The renderer identifies error
            // parts by looking up the original DisplayMessage (via getExternalStoreMessages)
            // and matching the text to the error block's message field.
            parts.push({ type: 'text', text: block.message });
            break;
          case 'permission_request':
            parts.push(PERMISSION_PLACEHOLDER);
            break;
        }
      }

      return {
        role: 'assistant',
        content: parts.length > 0 ? parts : [{ type: 'text', text: '' }],
        id: message.id,
        createdAt: new Date(message.timestamp),
      };
    }

    case 'error': {
      const errorBlock = message.content.find((c): c is DisplayContent & { type: 'error' } => c.type === 'error');
      // Fall back when the message is missing, empty, OR whitespace-only — an
      // error bubble must always render visible text, and MainframeText drops
      // blank-after-trim text parts before its error check.
      const errorText = errorBlock?.message?.trim() ? errorBlock.message : 'An error occurred';
      return {
        role: 'assistant',
        content: [{ type: 'text', text: errorText }],
        id: message.id,
        createdAt: new Date(message.timestamp),
      };
    }

    case 'permission':
      return {
        role: 'assistant',
        content: [PERMISSION_PLACEHOLDER],
        id: message.id,
        createdAt: new Date(message.timestamp),
      };

    default:
      return {
        role: 'assistant',
        content: [{ type: 'text', text: '' }],
        id: message.id,
        createdAt: new Date(message.timestamp),
      };
  }
}
