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
 * on its own line. Consecutive reasoning parts coalesce into one `group-reasoning`
 * block (the canonical native pattern: one ReasoningRoot wrapping the leaves).
 */
import type { PartState } from '@assistant-ui/react';

export type ChatGroupKey = `group-${string}`;
export type PartGroups = Readonly<Record<string, string>>;

/**
 * Builds a `groupBy` bound to one message's daemon group membership. Memoize on
 * `partGroups` identity at the call site so GroupedParts can reuse its tree.
 * The AssistantMessage switch tells the two group kinds apart by `'group-reasoning'`
 * vs the dynamic `group-tool-<groupId>` keys.
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
