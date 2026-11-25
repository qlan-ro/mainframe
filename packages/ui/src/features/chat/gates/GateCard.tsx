import type { ControlResponse, ExecutionMode } from '@qlan-ro/mainframe-types';
import { useAdapters } from '@/store/adapters';
import type { ChatPermissionEntry } from '../controller/chat-thread-state';
import type { GateContext } from './gate-types';
import { PermissionGate } from './PermissionGate';
import { AskUserQuestionGate } from './AskUserQuestionGate';
import { PlanGate } from './PlanGate';

interface GateCardProps {
  entry: ChatPermissionEntry;
  reply: (response: ControlResponse, selectedOptionId?: string) => Promise<void>;
  /** The gated chat's adapter: the plan gate offers `auto` only when it advertises `capabilities.autoMode`. */
  adapterId: string | undefined;
  /** The asking chat, for the plan gate's once-per-session Unattended question. */
  chatId?: string;
  /** Who is asking and how many wait behind (G5). */
  context?: GateContext;
  /** The asking chat's permission mode, preselected by the plan gate. */
  composerMode?: ExecutionMode;
}

/**
 * One pending gate, dispatched by `ControlRequest.toolName`.
 *
 * A synthesized request (no daemon `_meta.controlRequest`) never carries the
 * `input` the rich Plan/AskUserQuestion cards read, so it routes to the
 * generic options-only card regardless of toolName (spec decision 27).
 */
export function GateCard({ entry, reply, adapterId, chatId, context, composerMode }: GateCardProps) {
  const adapters = useAdapters();
  const { toolName } = entry.request;
  if (entry.synthesizedRequest) return <PermissionGate entry={entry} reply={reply} context={context} />;
  if (toolName === 'AskUserQuestion') return <AskUserQuestionGate entry={entry} reply={reply} context={context} />;
  if (toolName === 'ExitPlanMode') {
    const adapter = adapters.find((a) => a.id === adapterId);
    return (
      <PlanGate
        entry={entry}
        reply={reply}
        context={context}
        chatId={chatId}
        composerMode={composerMode}
        autoAllowed={adapter?.capabilities.autoMode === true}
      />
    );
  }
  return <PermissionGate entry={entry} reply={reply} context={context} />;
}
