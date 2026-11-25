/**
 * A task chat's live transcript, for its parent's `delegate_task` card — read
 * through the same per-chat controller the child's own thread uses (`chatControllerRegistry`), so opening the child afterwards finds it
 * warm. Its requests show above the parent's composer (`gates/use-gate-queue`).
 *
 * Mounted only while the card is expanded: the hook holds the controller's
 * facade activation (`holdActive`), which attaches the
 * child's session on the shared per-adapter `/acp/{profile}` connection — a
 * `session/resume` on a socket the app already has, not a new one — and
 * releases it on collapse or unmount, which detaches the stream again. The
 * side-band subscription goes with it: the rows of the task's own sub-agents
 * read its background tasks.
 */
import { useEffect, useMemo } from 'react';
import type { ThreadMessage } from '@assistant-ui/react';
import { useChatController } from '@/features/sessions/runtime/use-chat-controller';
import { useDaemonPort } from '@/features/sessions/runtime/daemon-port-context';
import { pendingCalls, sessionRuns } from '@/features/workspace-chat/agent-status';
import type { ChatThreadState, LoadState } from '../controller/chat-thread-state';
import type { AgentWorld } from '../messages/turn/agent-world';
import { chatTurns, overCalls } from '../messages/turn/chat-turns';
import { useAgentWorld } from '../messages/turn/use-live-children';
import { useControllerState } from '../runtime/use-chat-thread-runtime';
import { useNativeThreadMessages } from '../runtime/use-native-thread-messages';
import { TurnCache } from '../view-model/turn/turn-cache';
import { latestMessages } from './task-chat-window';

export interface TaskChatView {
  messages: readonly ThreadMessage[];
  hiddenCount: number;
  loadState: LoadState;
  /** The calls of the child's that wait on a request. */
  pendingToolIds: ReadonlySet<string>;
  state: ChatThreadState;
  /** What the child's chat knows of its sub-agents. */
  world: AgentWorld;
}

export function useTaskChat(chatId: string): TaskChatView {
  const port = useDaemonPort();
  const controller = useChatController(chatId, port);
  // The hold also loads a cold controller (ChatActivation.ensureFacadeActive).
  useEffect(() => {
    const stop = controller.subscribeLive();
    const release = controller.holdActive();
    return () => {
      release();
      stop();
    };
  }, [controller]);

  const state = useControllerState(controller);
  const all = useNativeThreadMessages(state);
  const bounded = useMemo(() => latestMessages(all), [all]);
  const pendingToolIds = useMemo(() => pendingCalls(state), [state]);
  const cache = useMemo(() => new TurnCache(), []);
  const turns = useMemo(() => chatTurns(all, state, cache), [all, state, cache]);
  const agents = useMemo(
    () => [...turns.turns.values()].some((turn) => turn.children.some((child) => child.call)),
    [turns],
  );
  const known = useAgentWorld(chatId, state.backgroundTasks, agents, sessionRuns(state));
  const world = useMemo(() => ({ ...known, over: overCalls(turns) }), [known, turns]);

  return {
    messages: bounded.shown,
    hiddenCount: bounded.hiddenCount,
    loadState: state.loadState,
    pendingToolIds,
    state,
    world,
  };
}
