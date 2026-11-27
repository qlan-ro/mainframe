import type { ThreadMessage, ToolCallMessagePart } from '@assistant-ui/react';

export interface SubagentCall {
  part: ToolCallMessagePart;
  /** The top-level message the call is in: what nested disclosure keys and history loads go by. */
  messageId: string;
  /** The agents' calls it lies in, the outermost first. */
  ancestors?: readonly ToolCallMessagePart[];
}

const known = new WeakMap<ToolCallMessagePart, SubagentCall>();
const sameAncestors = (a: readonly ToolCallMessagePart[] = [], b: readonly ToolCallMessagePart[] = []) =>
  a.length === b.length && a.every((part, index) => part === b[index]);

/**
 * A sub-agent's call anywhere in a transcript, nested agents included. The same call, still in the
 * same message, is the same object: a stream delta elsewhere in the transcript changes nothing here.
 */
export function findSubagentCall(messages: readonly ThreadMessage[], toolCallId: string): SubagentCall | null {
  const found = search(messages, toolCallId);
  if (!found) return null;
  const before = known.get(found.part);
  if (before && before.messageId === found.messageId && sameAncestors(before.ancestors, found.ancestors)) return before;
  known.set(found.part, found);
  return found;
}

function search(messages: readonly ThreadMessage[], toolCallId: string): SubagentCall | null {
  for (const message of messages) {
    for (const part of message.content) {
      if (part.type !== 'tool-call') continue;
      if (part.toolCallId === toolCallId) return { part, messageId: message.id };
      const nested = search(part.messages ?? [], toolCallId);
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
