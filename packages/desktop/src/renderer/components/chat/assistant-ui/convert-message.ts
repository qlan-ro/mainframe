import type { ThreadMessageLike, TextMessagePart } from '@assistant-ui/react';
import type { MessageContent } from '@mainframe/types';
import {
  type GroupedMessage,
  groupMessages,
  type ToolGroupItem,
  type TaskProgressItem,
  type PartEntry,
  type ToolCategories,
  groupToolCallParts,
  groupTaskChildren,
} from '@mainframe/core/messages';

const CLAUDE_CATEGORIES: ToolCategories = {
  explore: new Set(['Read', 'Glob', 'Grep']),
  hidden: new Set([
    'TaskList',
    'TaskGet',
    'TaskOutput',
    'TaskStop',
    'TodoWrite',
    'Skill',
    'EnterPlanMode',
    'AskUserQuestion',
  ]),
  progress: new Set(['TaskCreate', 'TaskUpdate']),
  subagent: new Set(['Task']),
};

/** Returns tool categories for a given adapterId, defaulting to Claude's categories. */
export function getToolCategoriesForAdapter(adapterId: string | undefined): ToolCategories {
  if (!adapterId || adapterId === 'claude') return CLAUDE_CATEGORIES;
  return { explore: new Set(), hidden: new Set(), progress: new Set(), subagent: new Set() };
}

// Mutable version of the content array element type (ThreadMessageLike['content'] is readonly)
type ContentPart = Exclude<ThreadMessageLike['content'], string>[number];

// Re-export for consumers that import from this module
export { type GroupedMessage, groupMessages, type ToolGroupItem, type TaskProgressItem, type PartEntry };

// Sentinel placeholders — null-byte prefix prevents collision with user content
export const ERROR_PLACEHOLDER = Object.freeze({ type: 'text' as const, text: '\0__MF_ERROR__' });
export const PERMISSION_PLACEHOLDER = Object.freeze({ type: 'text' as const, text: '\0__MF_PERMISSION__' });

/**
 * Maps a single ChatMessage → ThreadMessageLike for the external store runtime.
 */
export function convertMessage(message: GroupedMessage): ThreadMessageLike {
  switch (message.type) {
    case 'user': {
      const userParts: TextMessagePart[] = [];
      for (const c of message.content) {
        if (c.type === 'text' && c.text) {
          userParts.push({ type: 'text' as const, text: c.text });
        }
      }
      return {
        role: 'user',
        content: userParts.length > 0 ? userParts : [{ type: 'text' as const, text: '' }],
        id: message.id,
        createdAt: new Date(message.timestamp),
      };
    }

    case 'system':
      return {
        role: 'system',
        content: message.content
          .filter((c): c is MessageContent & { type: 'text' } => c.type === 'text')
          .map((c) => ({ type: 'text' as const, text: c.text })),
        id: message.id,
        createdAt: new Date(message.timestamp),
      };

    case 'assistant':
    case 'tool_use': {
      const parts: ContentPart[] = [];

      for (const block of message.content) {
        switch (block.type) {
          case 'text':
            parts.push({ type: 'text', text: block.text });
            break;
          case 'thinking':
            parts.push({ type: 'reasoning' as const, text: block.thinking });
            break;
          case 'tool_use': {
            const tr = message._toolResults?.get(block.id);
            parts.push({
              type: 'tool-call',
              toolCallId: block.id,
              toolName: block.name,
              args: block.input as import('assistant-stream/utils').ReadonlyJSONObject,
              result: tr
                ? tr.structuredPatch
                  ? {
                      content: tr.content,
                      structuredPatch: tr.structuredPatch,
                      originalFile: tr.originalFile,
                      modifiedFile: tr.modifiedFile,
                    }
                  : tr.content
                : undefined,
              isError: tr?.isError,
            });
            break;
          }
          case 'tool_result': {
            // Orphan tool_result not matched to a tool_use — show as text
            parts.push({
              type: 'text',
              text: `[Tool Result] ${block.content}`,
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

      const categories = getToolCategoriesForAdapter(message.metadata?.adapterId as string | undefined);
      const afterGrouping = groupToolCallParts(parts as PartEntry[], categories);
      const grouped = groupTaskChildren(afterGrouping, categories) as ThreadMessageLike['content'];

      return {
        role: 'assistant',
        content: (grouped as Array<unknown>).length > 0 ? grouped : [{ type: 'text', text: '' }],
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
