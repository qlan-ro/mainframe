import type { ThreadMessage, ToolCallMessagePart } from '@assistant-ui/react';

export interface SubagentCall {
  part: ToolCallMessagePart;
  /** The top-level message the call is in: what nested disclosure keys and history loads go by. */
  messageId: string;
  /** The agents' calls it lies in, the outermost first. */
  ancestors?: readonly ToolCallMessagePart[];
}

/** A sub-agent's call anywhere in a transcript, nested agents included. */
export function findSubagentCall(messages: readonly ThreadMessage[], toolCallId: string): SubagentCall | null {
  for (const message of messages) {
    for (const part of message.content) {
      if (part.type !== 'tool-call') continue;
      if (part.toolCallId === toolCallId) return { part, messageId: message.id };
      const nested = findSubagentCall(part.messages ?? [], toolCallId);
      if (nested) return { ...nested, messageId: message.id, ancestors: [part, ...(nested.ancestors ?? [])] };
    }
  }
  return null;
}

/** Every tool call a sub-agent made, at any depth. */
export function toolCallIdsOf(messages: readonly ThreadMessage[]): string[] {
  return messages.flatMap((message) =>
    message.content.flatMap((part) =>
      part.type === 'tool-call' ? [part.toolCallId, ...toolCallIdsOf(part.messages ?? [])] : [],
    ),
  );
}
