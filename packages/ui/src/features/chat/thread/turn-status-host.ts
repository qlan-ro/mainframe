/**
 * Where the running turn's status lives: one place per turn, never two.
 *
 * While the compact transcript ends in a live element — an active activity group,
 * or a running standalone tool row — that element's header hosts the status (its
 * spinner and step label, plus the clock and task count). Otherwise the turn
 * status row does. States the user must act on or wait out — a pending
 * permission, Stop, compaction — always stay on the row, which can say them.
 * The row and the hosts all read this one hook, so they cannot disagree.
 *
 * The host is named by its disclosure identity, which an activity group (its
 * first member) and a standalone tool row share: `activityMemberIdentity`.
 */
import { useAuiState } from '@assistant-ui/react';
import { useChatExtrasSelector } from '../runtime/chat-extras';
import { useOptionalTurnPresentationSelector } from '../messages/compact/turn-presentation-context';
import { activityMemberIdentity } from '../view-model/compact/build-activity-groups';
import { hasRunningMember } from '../view-model/compact/activity-label';
import { resolveToolStatus } from '../view-model/compact/tool-status';
import type { DisplayUnit } from '../view-model/compact/turn-types';
import { statusAnchorId } from './turn-phase';

function liveHostKey(unit: DisplayUnit, pending: ReadonlySet<string>): string | null {
  const group = unit.activity?.group;
  // Live exactly as its header decides: the open tail, or any member still running.
  if (group) return group.active || hasRunningMember(group, pending) ? activityMemberIdentity(group.members[0]!) : null;
  const part = unit.part;
  if (part.type !== 'tool-call' || resolveToolStatus(part, pending) !== 'running') return null;
  return activityMemberIdentity(unit);
}

const noPendingTools: ReadonlySet<string> = new Set();

/** Mounted by every compact tool row, so it reads narrow selectors, never the whole extras object. */
export function useTurnStatusHost(): string | null {
  const isRunning = useAuiState((s) => s.thread.isRunning);
  const anchor = useAuiState((s) => statusAnchorId(s.thread.messages));
  // A pending permission keeps the status on the row, so a host never needs the pending tool set.
  const attention = useChatExtrasSelector(
    (extras) =>
      extras?.state.runState.type === 'cancelling' ||
      extras?.state.compacting === true ||
      Object.keys(extras?.permissions ?? {}).length > 0,
  );
  // The transcript's last visible unit, at or before the anchor (queued prompts follow it). A group's
  // members can span messages and render once, on its first message, so a message whose units were all
  // absorbed is skipped; a native message (a user prompt, or one without turn metadata) ends the search.
  const host = useOptionalTurnPresentationSelector((value) => {
    const messages = value.model.messages;
    for (let index = messages.findIndex((message) => message.messageId === anchor); index >= 0; index--) {
      const { native, units } = messages[index]!;
      if (native) return null;
      if (units.length) return liveHostKey(units[units.length - 1]!, noPendingTools);
    }
    return null;
  }, null);
  return isRunning && !attention ? host : null;
}
