/**
 * Pure DisplayMessage → ThreadMessageLike translator.
 *
 * Copied from packages/desktop/src/renderer/components/chat/assistant-ui/convert-message.ts
 * (reference: 2026-06-05 snapshot). Desktop copy is NOT edited — temporary duplication;
 * dedup into @qlan-ro/mainframe-core view-model in a follow-up.
 *
 * Invariants preserved:
 * - WS14c dual re-encode: tool_group / task_progress re-encoded at top-level AND
 *   nested inside task_group.calls (see map-task-group.ts).
 * - \0 permission sentinel prevents collision with real user content.
 * - Per-message uniqueId() dedup guards against duplicate toolCallId crashes.
 * - ≥1 content-part + error fallbacks so assistant-ui never gets an empty array.
 */
import type { ThreadMessageLike } from '@assistant-ui/react';
import type { DisplayMessage, DisplayContent } from '@qlan-ro/mainframe-types';
import { mapTaskGroupChild } from './map-task-group';

type ContentPart = Exclude<ThreadMessageLike['content'], string>[number];

/** Null-byte prefix prevents collision with user content. */
export const PERMISSION_PLACEHOLDER = Object.freeze({
  type: 'text' as const,
  text: '\0__MF_PERMISSION__',
});

function mapToolCall(block: DisplayContent & { type: 'tool_call' }): ContentPart {
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
      const skillBlock = message.content.find(
        (c): c is DisplayContent & { type: 'skill_loaded' } => c.type === 'skill_loaded',
      );
      const textParts = message.content
        .filter((c): c is DisplayContent & { type: 'text' } => c.type === 'text')
        .map((c) => ({ type: 'text' as const, text: c.text }));

      const meta: Record<string, unknown> = { ...(message.metadata ?? {}) };
      if (skillBlock) {
        meta['skillLoaded'] = {
          skillName: skillBlock.skillName,
          path: skillBlock.path,
          content: skillBlock.content,
        };
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

      // Guard against duplicate toolCallId — assistant-ui crashes on "Duplicate key".
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
            // Handled by user-message renderer; skip here.
            break;

          case 'tool_call':
            if (block.category !== 'hidden') {
              const mapped = mapToolCall(block);
              if (mapped.type === 'tool-call') {
                parts.push({ ...mapped, toolCallId: uniqueId(block.id, parts.length) });
              } else {
                parts.push(mapped);
              }
            }
            break;

          case 'tool_group': {
            // WS14c top-level re-encode
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
            // WS14c dual re-encode delegated to mapTaskGroupChild (see map-task-group.ts)
            const children = block.calls
              .map((c) => mapTaskGroupChild(c))
              .filter((x): x is NonNullable<typeof x> => x !== null);

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

          case 'task_progress': {
            // WS14c top-level re-encode
            parts.push({
              type: 'tool-call',
              toolCallId: uniqueId(block.items[0]?.id ?? '', parts.length),
              toolName: '_TaskProgress',
              args: {
                items: block.items.map((item) => ({
                  toolCallId: item.id,
                  toolName: item.name,
                  args: item.input,
                  result: item.result,
                  isError: item.result?.isError,
                })),
              } as unknown as import('assistant-stream/utils').ReadonlyJSONObject,
              result: 'accumulated',
            });
            break;
          }

          case 'error':
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
