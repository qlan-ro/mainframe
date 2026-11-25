/** How a sub-agent's work stands, for the zone that shows it alone: the turn that started it is not drawn there. Pure. */
import type { ThreadMessage, ToolCallMessagePart } from '@assistant-ui/react';
import type { BackgroundTask } from '@qlan-ro/mainframe-types';
import type { ChatThreadState } from '../controller/chat-thread-state';
import { agentOutcome, type AgentOutcome } from '../messages/turn/agent-outcome';
import { resolveResultText } from '../tools/shared';
import { buildTurns } from '../view-model/turn/build-turns';
import type { TurnCache } from '../view-model/turn/turn-cache';
import { nestedPending } from '../view-model/turn/turn-roles';
import { agentLaunched } from '../view-model/turn/tool-values';
import { settledStatus } from '../view-model/turn/tool-status';
import type { ToolPart, TurnScope } from '../view-model/turn/types';
import { findSubagentCall } from './find-subagent-transcript';

export function pendingToolIds({ interactions }: Pick<ChatThreadState, 'interactions'>): ReadonlySet<string> {
  const ids = Object.values(interactions.permissions).map(({ request }) => request.toolUseId);
  return new Set(ids.filter((id): id is string => Boolean(id)));
}

/** The scope the chat's own transcript builds its turns in. */
export function zoneScope(state: Pick<ChatThreadState, 'interactions' | 'runState' | 'run'>): TurnScope {
  const isRunning = ['running', 'cancelling'].includes(state.runState.type);
  return {
    rootThreadId: '',
    ancestors: [],
    pendingToolIds: pendingToolIds(state),
    isRunning,
    runAfter: state.run?.after,
  };
}

/** Whether the turn part that started the call, or the agent around it, can still be going. */
export function callLive(
  messages: readonly ThreadMessage[],
  toolCallId: string,
  scope: TurnScope,
  cache?: TurnCache,
): boolean {
  const holder = messages.find((message) => findSubagentCall([message], toolCallId));
  if (!holder) return scope.isRunning === true;
  const { slices, turns } = buildTurns(messages, scope, cache);
  return turns.get(slices.get(holder.id)?.turnKey ?? '')?.live ?? false;
}

export interface OutcomeSources {
  readonly pending: ReadonlySet<string>;
  /** Its turn part can still be going (`callLive`). */
  readonly live: boolean;
  readonly running: ChatThreadState['backgroundTasks'];
  /** Which call started each background task: only the daemon's list says. */
  readonly listed: readonly BackgroundTask[];
}

/** One that outlived its call is told by the daemon's task for that call, not by the call. */
function launchedOutcome(toolCallId: string, { running, listed }: OutcomeSources): AgentOutcome | undefined {
  const own = listed.filter((task) => task.kind === 'agent' && task.toolUseId === toolCallId);
  if (own.some((task) => task.status === 'running' && running[task.id])) return 'going';
  // A recovered task's status is a guess the daemon made when it started.
  const ended = own.find((task) => !task.recovered && (task.status === 'stopped' || task.status === 'failed'));
  return ended && (ended.status === 'failed' ? 'failed' : 'stopped');
}

export function subagentOutcome(call: ToolCallMessagePart, sources: OutcomeSources): AgentOutcome {
  const part = { status: { type: 'complete' }, ...call } as ToolPart;
  if (nestedPending(part, sources.pending)) return 'going';
  const launched = agentLaunched(resolveResultText(part.result).text);
  const known = launched ? launchedOutcome(part.toolCallId, sources) : undefined;
  return (
    known ?? agentOutcome(settledStatus(part, sources.pending, sources.live || sources.pending.has(part.toolCallId)))
  );
}
