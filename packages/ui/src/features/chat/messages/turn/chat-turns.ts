/** A chat's turns, for what shows a part of it where no turn transcript is drawn. Pure. */
import type { ThreadMessage, ToolCallMessagePart } from '@assistant-ui/react';
import { pendingCalls, sessionRuns } from '@/features/workspace-chat/agent-status';
import type { ChatThreadState } from '../../controller/chat-thread-state';
import { buildTurns } from '../../view-model/turn/build-turns';
import type { TurnCache } from '../../view-model/turn/turn-cache';
import type { ToolPart, TurnModel, TurnScope } from '../../view-model/turn/types';
import { readAgentWork, type AgentWorld } from './agent-world';

/** The scope the chat's own transcript builds its turns in. */
export function chatTurnScope(state: Pick<ChatThreadState, 'interactions' | 'runState' | 'run'>): TurnScope {
  return {
    rootThreadId: '',
    ancestors: [],
    pendingToolIds: pendingCalls(state),
    isRunning: sessionRuns(state),
    runAfter: state.run?.after,
  };
}

/**
 * `window`: the chat's own messages, given when `messages` is a call's copy from outside them. That
 * copy is older than the whole window, so it is in the current run only when the run began before
 * the window did; a copy alone would otherwise count as the run's last message.
 */
export function chatTurns(
  messages: readonly ThreadMessage[],
  state: ChatThreadState,
  cache: TurnCache,
  window: readonly ThreadMessage[] | null = null,
): TurnModel {
  const scope = chatTurnScope(state);
  const after = scope.runAfter;
  const olderThanRun = window != null && typeof after === 'string' && window.some(({ id }) => id === after);
  return buildTurns(messages, olderThanRun ? { ...scope, isRunning: false } : scope, cache);
}

/** The calls of parts that can't be going. */
export function overCalls({ slices, turns }: TurnModel): ReadonlySet<string> {
  const over = [...slices.values()].filter(({ turnKey }) => !turns.get(turnKey)?.live);
  return new Set(
    over.flatMap(({ work }) => work.flatMap(({ part }) => (part.type === 'tool-call' ? [part.toolCallId] : []))),
  );
}

/** A call's part outside a message's rendering: what its status says is in the call itself. */
export const asToolPart = (part: ToolCallMessagePart): ToolPart =>
  ({ status: { type: 'complete' }, ...part }) as ToolPart;

/**
 * Whether what holds a call can be going: the part of the turn its message is in,
 * and every agent around it.
 */
export function holderLive(
  { turns, slices }: TurnModel,
  call: { messageId: string; ancestors?: readonly ToolCallMessagePart[] },
  pending: ReadonlySet<string>,
  world: AgentWorld,
): boolean {
  const turnLive = turns.get(slices.get(call.messageId)?.turnKey ?? '')?.live ?? false;
  return (call.ancestors ?? []).reduce(
    (live, agent) => readAgentWork(asToolPart(agent), pending, live, world).outcome === 'going',
    turnLive,
  );
}
