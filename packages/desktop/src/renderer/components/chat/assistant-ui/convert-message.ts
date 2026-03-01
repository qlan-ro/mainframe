import type { ThreadMessageLike } from '@assistant-ui/react';
import type { DisplayMessage, DisplayContent } from '@mainframe/types';

// Mutable version of the content array element type (ThreadMessageLike['content'] is readonly)
type ContentPart = Exclude<ThreadMessageLike['content'], string>[number];

// Re-export for consumers that import from this module
export type { ToolGroupItem, TaskProgressItem, PartEntry } from '@mainframe/core/messages';

// Sentinel placeholders — null-byte prefix prevents collision with user content
export const ERROR_PLACEHOLDER = Object.freeze({ type: 'text' as const, text: '\0__MF_ERROR__' });
export const PERMISSION_PLACEHOLDER = Object.freeze({ type: 'text' as const, text: '\0__MF_PERMISSION__' });

function mapDisplayContentToToolCall(block: DisplayContent & { type: 'tool_call' }): ContentPart {
  const result = block.result
    ? block.result.structuredPatch
      ? {
          content: block.result.content,
          structuredPatch: block.result.structuredPatch,
          originalFile: block.result.originalFile,
          modifiedFile: block.result.modifiedFile,
        }
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

    case 'system':
      return {
        role: 'system',
        content: message.content
          .filter((c): c is DisplayContent & { type: 'text' } => c.type === 'text')
          .map((c) => ({ type: 'text' as const, text: c.text })),
        id: message.id,
        createdAt: new Date(message.timestamp),
      };

    case 'assistant': {
      const parts: ContentPart[] = [];

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
            parts.push(mapDisplayContentToToolCall(block));
            break;
          case 'tool_group': {
            const calls = block.calls.filter(
              (c): c is DisplayContent & { type: 'tool_call' } => c.type === 'tool_call',
            );
            parts.push({
              type: 'tool-call',
              toolCallId: calls[0]?.id ?? '',
              toolName: '_ToolGroup',
              args: {
                items: calls.map((c) => ({
                  toolCallId: c.id,
                  toolName: c.name,
                  args: c.input,
                  result: c.result,
                  isError: c.result?.isError,
                })),
              } as import('assistant-stream/utils').ReadonlyJSONObject,
              result: 'grouped',
            });
            break;
          }
          case 'task_group': {
            const calls = block.calls.filter(
              (c): c is DisplayContent & { type: 'tool_call' } => c.type === 'tool_call',
            );
            const firstCall = calls[0];
            parts.push({
              type: 'tool-call',
              toolCallId: block.agentId,
              toolName: '_TaskGroup',
              args: {
                taskArgs: firstCall?.input ?? {},
                children: calls.map((c) => ({
                  toolCallId: c.id,
                  toolName: c.name,
                  args: c.input,
                  result: c.result,
                  isError: c.result?.isError,
                })),
              } as import('assistant-stream/utils').ReadonlyJSONObject,
              result: firstCall?.result,
            });
            break;
          }
          case 'error':
            parts.push(ERROR_PLACEHOLDER);
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

    case 'error':
      return {
        role: 'assistant',
        content: [ERROR_PLACEHOLDER],
        id: message.id,
        createdAt: new Date(message.timestamp),
      };

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
