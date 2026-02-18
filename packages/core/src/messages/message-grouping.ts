import type { ChatMessage, MessageContent } from '@mainframe/types';

export interface GroupedMessage extends ChatMessage {
  _toolResults?: Map<string, MessageContent & { type: 'tool_result' }>;
}

/**
 * Merges consecutive assistant/tool_use messages into a single turn and
 * attaches tool_result data so assistant-ui can show both invocation and result.
 */
export function groupMessages(messages: ChatMessage[]): GroupedMessage[] {
  const result: GroupedMessage[] = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]!;

    // Internal turn metadata marker emitted on result events. Attach to the
    // most recent assistant turn and keep it out of the rendered thread.
    const turnDurationMs = typeof msg.metadata?.turnDurationMs === 'number' ? msg.metadata.turnDurationMs : null;
    if (msg.type === 'system' && turnDurationMs !== null) {
      for (let j = result.length - 1; j >= 0; j--) {
        const prev = result[j]!;
        if (prev.type === 'assistant' || prev.type === 'tool_use') {
          prev.metadata = { ...(prev.metadata ?? {}), turnDurationMs };
          break;
        }
      }
      continue;
    }

    if (msg.type === 'tool_result') {
      // Attach to preceding tool_use/assistant message if possible
      const prev = result[result.length - 1];
      if (prev && (prev.type === 'tool_use' || prev.type === 'assistant')) {
        if (!prev._toolResults) prev._toolResults = new Map();
        for (const block of msg.content) {
          if (block.type === 'tool_result') {
            prev._toolResults.set(block.toolUseId, block);
          }
        }
        continue;
      }
    }

    // Merge consecutive assistant/tool_use messages into one turn
    if (msg.type === 'assistant' || msg.type === 'tool_use') {
      const prev = result[result.length - 1];
      if (prev && (prev.type === 'assistant' || prev.type === 'tool_use')) {
        prev.content = [...prev.content, ...msg.content];
        continue;
      }
    }

    result.push({ ...msg });
  }

  // Deduplicate tool_use blocks by id across all messages.
  // Duplicates can appear when the store has stale messages from a previous daemon
  // connection and the resumed CLI re-streams overlapping content.
  const seenToolUseIds = new Set<string>();
  for (const msg of result) {
    if (msg.type !== 'assistant' && msg.type !== 'tool_use') continue;
    msg.content = msg.content.filter((block) => {
      if (block.type === 'tool_use') {
        if (seenToolUseIds.has(block.id)) return false;
        seenToolUseIds.add(block.id);
      }
      return true;
    });
  }

  return result;
}
