import type { ControlResponse } from '@qlan-ro/mainframe-types';
import { useAdapters } from '@/store/adapters';
import type { ChatPermissionEntry } from '../controller/chat-thread-state';
import { PermissionGate } from './PermissionGate';
import { AskUserQuestionGate } from './AskUserQuestionGate';
import { PlanGate } from './PlanGate';

interface GateCardProps {
  entry: ChatPermissionEntry;
  reply: (response: ControlResponse, selectedOptionId?: string) => Promise<void>;
  /** The gated chat's adapter: the plan gate offers `auto` only when it advertises `capabilities.autoMode`. */
  adapterId: string | undefined;
}

/**
 * One pending gate, dispatched by `ControlRequest.toolName` — shared by the
 * thread's own gate slot (`ChatGateMount`) and a task chat's gate inside its
 * parent's `delegate_task` card, so both answer through the same cards.
 *
 * A synthesized request (no daemon `_meta.controlRequest`) never carries the
 * `input` the rich Plan/AskUserQuestion cards read, so it routes to the
 * generic options-only card regardless of toolName (spec decision 27).
 */
export function GateCard({ entry, reply, adapterId }: GateCardProps) {
  const adapters = useAdapters();
  const { toolName } = entry.request;
  if (entry.synthesizedRequest) return <PermissionGate entry={entry} reply={reply} />;
  if (toolName === 'AskUserQuestion') return <AskUserQuestionGate entry={entry} reply={reply} />;
  if (toolName === 'ExitPlanMode') {
    const adapter = adapters.find((a) => a.id === adapterId);
    return <PlanGate entry={entry} reply={reply} autoAllowed={adapter?.capabilities.autoMode === true} />;
  }
  return <PermissionGate entry={entry} reply={reply} />;
}
