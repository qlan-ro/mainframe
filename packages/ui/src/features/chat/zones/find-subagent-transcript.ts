import type { ThreadMessage, ToolCallMessagePart } from '@assistant-ui/react';

export function findSubagentCall(
  messages: readonly ThreadMessage[],
  toolCallId: string,
): ToolCallMessagePart | undefined {
  for (const message of messages) {
    for (const part of message.content) {
      if (part.type !== 'tool-call') continue;
      if (part.toolCallId === toolCallId) return part;
      const nested = findSubagentCall(part.messages ?? [], toolCallId);
      if (nested) return nested;
    }
  }
  return undefined;
}
