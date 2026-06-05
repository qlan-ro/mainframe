/**
 * Client-side part grouping for MessagePrimitive.GroupedParts — daemon-authoritative.
 *
 * The daemon already decided the grouping (adapter-declared `categories.explore`
 * → `tool_group`). convert-message flattens those to native tool-calls and
 * records each one's group membership in `message.metadata.custom.mainframe.partGroups`
 * (toolCallId → groupId). This `groupBy` simply ECHOES that decision — no tool-name
 * heuristic, no re-derivation — so grouping is correct across every adapter.
 *
 * A standalone tool (Edit/Write/Bash/Task/_TaskProgress/marker pill) — and a LONE
 * explore tool, which the daemon never groups — has no recorded groupId and renders
 * on its own line. Reasoning parts coalesce into one collapsed block.
 */
import type { PartState } from '@assistant-ui/react';

export type ChatGroupKey = `group-${string}`;
export type PartGroups = Readonly<Record<string, string>>;

/**
 * Builds a `groupBy` bound to one message's daemon group membership. Memoize on
 * `partGroups` identity at the call site so GroupedParts can reuse its tree.
 */
export function makeChatGroupBy(partGroups: PartGroups): (part: PartState) => readonly ChatGroupKey[] {
  return (part) => {
    if (part.type === 'reasoning') return ['group-reasoning'];
    if (part.type === 'tool-call') {
      const groupId = partGroups[part.toolCallId];
      return groupId ? [`group-tool-${groupId}`] : [];
    }
    return [];
  };
}

/** True for a GroupedParts node key produced for a daemon tool group. */
export function isToolGroupKey(type: string): boolean {
  return type.startsWith('group-tool-');
}
