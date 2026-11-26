import { useMemo, useState } from 'react';
import type { BackgroundActivityTask } from '@qlan-ro/mainframe-types';
import { useChatTasks } from '@/features/workspace-chat/use-chat-tasks';
import { useChatExtrasSelector } from '../../runtime/chat-extras';
import { useSessionItems } from '../../orchestration/use-session-items';
import type { TurnModel } from '../../view-model/turn/types';
import { useAgentWorldContext, type AgentWorld } from './agent-world';
import { useOwnChatState } from '../../runtime/own-chat-state';
import { liveChildren, sameLive, type LiveChildren } from './live-children';

const NO_TASKS: Readonly<Record<string, BackgroundActivityTask>> = {};

/**
 * What the chat knows of its agents. The daemon's list says which call started
 * each background task, and is asked for once there is one to place: a running
 * task, or a sub-agent's call.
 */
export function useAgentWorld(
  chatId: string | undefined,
  events: Readonly<Record<string, BackgroundActivityTask>>,
  agents: boolean,
  runs: boolean,
  adapterId: string | undefined,
): AgentWorld {
  const listed = chatId !== undefined && !chatId.startsWith('__LOCALID_');
  const { tasks, live } = useChatTasks(chatId ?? '', events, listed && (agents || Object.keys(events).length > 0));
  return useMemo(() => ({ runs, tasks, live, adapterId }), [runs, tasks, live, adapterId]);
}

/** Where each turn's child work stands; the same object until one of them moves. */
export function useLiveChildren(
  model: TurnModel,
  chatId: string | undefined,
  runs: boolean,
): { children: LiveChildren; world: AgentWorld } {
  const live = useOwnChatState((state) => state.backgroundTasks) ?? NO_TASKS;
  const agents = useMemo(
    () => [...model.turns.values()].some((turn) => turn.children.some((child) => child.call || child.workflowTaskId)),
    [model],
  );
  const adapterId = useChatExtrasSelector((extras) => extras?.state.chatConfig?.adapterId);
  const world = useAgentWorld(chatId, live, agents, runs, adapterId);
  return { children: useChildEvidence(model, world, live), world };
}

export function useNestedLiveChildren(model: TurnModel): LiveChildren {
  const world = useAgentWorldContext();
  const live = useOwnChatState((state) => state.backgroundTasks) ?? NO_TASKS;
  return useChildEvidence(model, world, live);
}

function useChildEvidence(model: TurnModel, world: AgentWorld, live: Readonly<Record<string, BackgroundActivityTask>>) {
  const sessions = useSessionItems();
  const workflowRuns = useOwnChatState((state) => state.workflowRuns);
  const { tasks: listed, live: listLive, runs } = world;
  const next = useMemo(
    () => liveChildren(model, { sessions, live, listed, listLive, runs, workflowRuns }),
    [model, sessions, live, listed, listLive, runs, workflowRuns],
  );
  const [kept, setKept] = useState(next);
  if (kept !== next && !sameLive(kept, next)) setKept(next);
  return kept;
}
