/**
 * What the chat a transcript is of knows of its agents: the evidence the Agent
 * tab reads (`workspace-chat/agent-status`), so a call's row says what its tab
 * does (T1c). Without a provider nothing is known, and no agent reads as running.
 */
import { createContext, useContext, useMemo } from 'react';
import { backgroundStopKey, useStop } from '@/features/session-panel/use-stop';
import {
  agentStanding,
  callFacts,
  stoppableTask,
  type AgentStanding,
  type AgentTasks,
} from '@/features/workspace-chat/agent-status';
import { ownTasks } from '@/features/workspace-chat/use-chat-tasks';
import { stopBackgroundTask } from '@/lib/api/background-tasks';
import { settledStatus } from '../../view-model/turn/tool-status';
import type { ToolPart, ToolStatus } from '../../view-model/turn/types';
import { agentOutcome, type AgentOutcome } from './agent-outcome';
import type { RowStatus } from './tool-icons';
import { useTranscriptScope } from './transcript-scope';

export interface AgentWorld {
  /** The chat's session runs. */
  readonly runs: boolean;
  /** The daemon's task list of the chat. */
  readonly tasks: AgentTasks;
  /** The list is the latest over a connection that still stands. */
  readonly live: boolean;
  /** The CLI its session runs on. */
  readonly adapterId?: string;
  /** Calls of parts that can't be going, where no turn around them says so (a delegated task's own chat). */
  readonly over?: ReadonlySet<string>;
}

const UNKNOWN: AgentWorld = { runs: false, tasks: null, live: false };
const Context = createContext<AgentWorld>(UNKNOWN);
export const useAgentWorldContext = () => useContext(Context);
export const AgentWorldProvider = Context.Provider;

export interface AgentWork {
  readonly standing: AgentStanding | null;
  readonly status: RowStatus;
  readonly outcome: AgentOutcome;
}

const isUnsettled = (status: RowStatus) => status === 'running' || status === 'awaiting-approval';

/**
 * What the tab says, else how the call itself ended, if it says. Only the tab's
 * evidence makes it run, wait or stop.
 */
export function agentWork(own: ToolStatus, standing: AgentStanding | null): AgentWork {
  if (standing?.status === 'needs-you')
    return { standing, status: own === 'awaiting-approval' ? own : 'needs-you', outcome: 'going' };
  if (standing) return { standing, status: standing.status, outcome: agentOutcome(standing.status) };
  // Not known to run any more, nor to have ended: what it wrote is no answer yet.
  if (isUnsettled(own)) return { standing, status: 'unknown', outcome: 'unknown' };
  return { standing, status: own, outcome: agentOutcome(own) };
}

/** How a call stands in the chat it is in. `partLive`: what holds it can be going. */
export function readAgentWork(
  part: ToolPart,
  pending: ReadonlySet<string>,
  partLive: boolean,
  { runs, tasks, live }: AgentWorld,
): AgentWork {
  const facts = callFacts({ part, messageId: '' }, pending);
  const own = ownTasks(tasks, part.toolCallId);
  const standing = agentStanding({ facts, tasks: own, goes: runs && partLive, live });
  return agentWork(settledStatus(part, pending, partLive), standing);
}

/** How a sub-agent's call stands in the transcript around it. */
export function useAgentWork(part: ToolPart): AgentWork {
  const { pendingToolIds, live = true } = useTranscriptScope();
  const world = useContext(Context);
  const partLive = live && !world.over?.has(part.toolCallId);
  return useMemo(() => readAgentWork(part, pendingToolIds, partLive, world), [part, pendingToolIds, partLive, world]);
}

/** Stop for a sub-agent's row: the same task, by the same route, as its tab's (W8). */
export function useAgentStop(toolCallId: string, title: string) {
  const { chatId } = useTranscriptScope();
  const { tasks, live, adapterId } = useContext(Context);
  const task = chatId === undefined ? undefined : stoppableTask(ownTasks(tasks, toolCallId), live, adapterId);
  return useStop(title, task && (() => stopBackgroundTask(chatId!, task.id)), backgroundStopKey(chatId, task));
}
