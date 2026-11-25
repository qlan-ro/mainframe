/**
 * Which sub-agent a request came from. A request carries only its tool call,
 * so the sub-agent is the top-level Agent call whose own transcript holds it.
 */
import type { ThreadMessage } from '@assistant-ui/react';

export interface RequestingSubagent {
  toolCallId: string;
  name: string;
  title: string;
}

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

function holdsCall(messages: readonly ThreadMessage[], toolUseId: string): boolean {
  return messages.some((message) =>
    message.content.some(
      (part) =>
        part.type === 'tool-call' && (part.toolCallId === toolUseId || holdsCall(part.messages ?? [], toolUseId)),
    ),
  );
}

export function subagentOf(messages: readonly ThreadMessage[], toolUseId: string): RequestingSubagent | null {
  if (!toolUseId) return null;
  for (let i = messages.length - 1; i >= 0; i--) {
    for (const part of messages[i]!.content) {
      if (part.type !== 'tool-call' || !part.messages?.length || !holdsCall(part.messages, toolUseId)) continue;
      const args = (part.args ?? {}) as Record<string, unknown>;
      const title = text(args.description);
      return {
        toolCallId: part.toolCallId,
        name: text(args.subagent_type) || title || 'Sub-agent',
        title: title || text(args.subagent_type) || 'Sub-agent',
      };
    }
  }
  return null;
}
