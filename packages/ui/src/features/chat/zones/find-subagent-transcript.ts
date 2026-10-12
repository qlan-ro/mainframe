import type { ThreadMessage } from '@assistant-ui/react';

export function findSubagentTranscript(
  messages: readonly ThreadMessage[],
  toolCallId: string,
): readonly ThreadMessage[] | null {
  for (const message of messages) {
    for (const part of message.content) {
      if (part.type !== 'tool-call') continue;
      if (part.toolCallId === toolCallId) return part.messages ?? [];
      const nested = findSubagentTranscript(part.messages ?? [], toolCallId);
      if (nested) return nested;
    }
  }
  return null;
}
