import { useMemo, useState } from 'react';
import type { BackgroundActivityTask } from '@qlan-ro/mainframe-types';
import { useChatTasks } from '@/features/workspace-chat/use-chat-tasks';
import { useChatExtrasSelector } from '../../runtime/chat-extras';
import { useSessionItems } from '../../orchestration/use-session-items';
import type { TurnModel } from '../../view-model/turn/types';
import type { AgentWorld } from './agent-world';
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
  const sessions = useSessionItems();
  const live = useChatExtrasSelector((extras) => extras?.state.backgroundTasks) ?? NO_TASKS;
  const agents = useMemo(
    () => [...model.turns.values()].some((turn) => turn.children.some((child) => child.call)),
    [model],
  );
  const adapterId = useChatExtrasSelector((extras) => extras?.state.chatConfig?.adapterId);
  const world = useAgentWorld(chatId, live, agents, runs, adapterId);
  const { tasks: listed, live: listLive } = world;
  const next = useMemo(
    () => liveChildren(model, { sessions, live, listed, listLive, runs }),
    [model, sessions, live, listed, listLive, runs],
  );
  const [kept, setKept] = useState(next);
  if (kept !== next && !sameLive(kept, next)) setKept(next);
  return { children: kept, world };
}
