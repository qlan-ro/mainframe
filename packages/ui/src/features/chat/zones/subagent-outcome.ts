/** How a sub-agent's work stands, for the zone that shows it alone: the turn that started it is not drawn there. Pure. */
import type { ToolCallMessagePart } from '@assistant-ui/react';
import type { ChatThreadState } from '../controller/chat-thread-state';
import { agentLaunched, agentOutcome, type AgentOutcome } from '../messages/turn/agent-outcome';
import { resolveResultText } from '../tools/shared';
import { nestedPending } from '../view-model/turn/turn-roles';
import { settledStatus } from '../view-model/turn/tool-status';
import type { ToolPart } from '../view-model/turn/types';

type Sources = Pick<ChatThreadState, 'interactions' | 'runState' | 'backgroundTasks'>;

export function pendingToolIds({ interactions }: Pick<ChatThreadState, 'interactions'>): ReadonlySet<string> {
  const ids = Object.values(interactions.permissions).map(({ request }) => request.toolUseId);
  return new Set(ids.filter((id): id is string => Boolean(id)));
}

export function subagentOutcome(call: ToolCallMessagePart, state: Sources): AgentOutcome {
  const part = { status: { type: 'complete' }, ...call } as ToolPart;
  const pending = pendingToolIds(state);
  const turnGoes = pending.size > 0 || ['running', 'cancelling'].includes(state.runState.type);
  const status = settledStatus(part, pending, turnGoes);
  if (nestedPending(part, pending)) return 'going';
  const inBackground = Object.values(state.backgroundTasks).some((task) => task.kind === 'agent');
  if (inBackground && agentLaunched(resolveResultText(part.result).text)) return 'going';
  return agentOutcome(status);
}
