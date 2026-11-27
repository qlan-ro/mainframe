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

/** A call's copy from outside the chat's own window: `window` is the chat's messages, `messageId` the copy's container. */
export interface DetachedCopy {
  window: readonly ThreadMessage[];
  messageId: string;
}

/**
 * Whether a copy outside the window can be in the current run. The run began after `run.after`, so
 * a copy older than the window is before it when that message is in the window; with no message
 * (`null`) the whole chat is the run. Otherwise the copy's own time says, against when the turn
 * began; with either unknown it is taken as not running.
 */
function inCurrentRun(copy: readonly ThreadMessage[], state: ChatThreadState, from: DetachedCopy): boolean {
  const after = state.run?.after;
  if (after === null) return true;
  if (typeof after === 'string' && from.window.some(({ id }) => id === after)) return false;
  const startedAt = 'startedAtMs' in state.runState ? state.runState.startedAtMs : undefined;
  const created = copy.find(({ id }) => id === from.messageId)?.createdAt?.getTime();
  return startedAt !== undefined && created !== undefined && created > 0 && created >= startedAt;
}

/**
 * `detached`: `messages` is a call's copy from outside the chat's window, an earlier turn unless
 * `inCurrentRun` says otherwise; one that is not is never running, and what keeps it open is a
 * pending request or a task, which do not depend on the run.
 */
export function chatTurns(
  messages: readonly ThreadMessage[],
  state: ChatThreadState,
  cache: TurnCache,
  detached: DetachedCopy | null = null,
): TurnModel {
  const scope = chatTurnScope(state);
  const over = detached != null && !inCurrentRun(messages, state, detached);
  return buildTurns(messages, over ? { ...scope, isRunning: false } : scope, cache);
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
