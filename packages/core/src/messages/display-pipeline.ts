import type { ChatMessage, ToolCategories, DisplayMessage } from '@qlan-ro/mainframe-types';
import { groupMessages } from './message-grouping.js';
import {
  isInternalUserMessage,
  convertAssistantContent,
  convertUserContent,
  applyToolGrouping,
} from './display-helpers.js';

/**
 * Transforms raw ChatMessage[] into display-ready DisplayMessage[].
 *
 * Pipeline steps:
 * 1. Filter internal user messages (mainframe commands, skill markers)
 * 2. Group consecutive assistant/tool_use turns, attach tool_results
 * 3. Handle turnDurationMs system markers
 * 4. Convert each grouped message to DisplayMessage
 * 5. Apply tool grouping when categories are provided
 */
export function prepareMessagesForClient(messages: ChatMessage[], categories?: ToolCategories): DisplayMessage[] {
  if (messages.length === 0) return [];

  // Step 1: Filter internal user messages
  const filtered = messages.filter((msg) => !(msg.type === 'user' && isInternalUserMessage(msg.content)));

  // Steps 2–3: Group consecutive assistant turns, attach tool_results,
  // handle turnDurationMs (all handled by groupMessages)
  const grouped = groupMessages(filtered);

  // Steps 4–5: Convert to DisplayMessage, deduplicating by id.
  // The CLI can reuse UUIDs (e.g. for compact_boundary entries), which causes
  // assistant-ui's MessageRepository to throw on duplicate ids.
  const result: DisplayMessage[] = [];
  const seenIds = new Set<string>();

  for (const gMsg of grouped) {
    const display = convertGroupedToDisplay(gMsg, categories);
    if (!display) continue;
    if (seenIds.has(display.id)) continue;
    seenIds.add(display.id);
    result.push(display);
  }

  return result;
}

function convertGroupedToDisplay(
  msg: ReturnType<typeof groupMessages>[number],
  categories?: ToolCategories,
): DisplayMessage | null {
  const base = {
    id: msg.id,
    chatId: msg.chatId,
    timestamp: msg.timestamp,
  };

  switch (msg.type) {
    case 'assistant':
    case 'tool_use': {
      let content = convertAssistantContent(msg, categories);
      if (categories) content = applyToolGrouping(content, categories);

      return {
        ...base,
        type: 'assistant',
        content,
        ...(msg.metadata && { metadata: { ...msg.metadata } }),
      };
    }

    case 'user': {
      const { displayContent, metadata: extraMeta } = convertUserContent(msg.content);
      const metadata = {
        ...(msg.metadata ?? {}),
        ...extraMeta,
      };
      return {
        ...base,
        type: 'user',
        content: displayContent,
        ...(Object.keys(metadata).length > 0 && { metadata }),
      };
    }

    case 'system':
      return {
        ...base,
        type: 'system',
        content: msg.content.map((c) => {
          if (c.type === 'text') return { type: 'text' as const, text: c.text };
          return { type: 'text' as const, text: '' };
        }),
        ...(msg.metadata && { metadata: { ...msg.metadata } }),
      };

    case 'error':
      return {
        ...base,
        type: 'error',
        content: msg.content.map((c) => {
          if (c.type === 'error') return { type: 'error' as const, message: c.message };
          return { type: 'text' as const, text: '' };
        }),
        ...(msg.metadata && { metadata: { ...msg.metadata } }),
      };

    case 'permission':
      return {
        ...base,
        type: 'permission',
        content: msg.content.map((c) => {
          if (c.type === 'permission_request') {
            return { type: 'permission_request' as const, request: c.request };
          }
          return { type: 'text' as const, text: '' };
        }),
        ...(msg.metadata && { metadata: { ...msg.metadata } }),
      };

    case 'tool_result':
      // Orphan tool_result without a preceding assistant/tool_use — suppress
      // instead of dumping raw tool output as a plain text message
      return null;

    default:
      return null;
  }
}
