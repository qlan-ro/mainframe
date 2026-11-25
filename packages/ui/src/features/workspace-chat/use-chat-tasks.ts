/** The daemon's task list of a chat, for as long as something in front shows its agents. */
import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import type { BackgroundActivityTask } from '@qlan-ro/mainframe-types';
import { useIsConnected } from '@/app/ConnectionStatusContext';
import { getActiveDaemon, subscribeActiveDaemon } from '@/lib/daemon/active-daemon';
import type { AgentTasks } from './agent-status';
import { findChatTasks, NOTHING_LISTED, openChatTasks, type ChatTasksState } from './chat-tasks';

const activeDaemonId = () => getActiveDaemon().id;

/** The tasks of one call, null while none are listed. */
export const ownTasks = (tasks: AgentTasks, toolCallId: string): AgentTasks =>
  tasks?.filter((task) => task.toolUseId === toolCallId) ?? null;

export function useChatTasks(
  chatId: string,
  /** A new object per background event. */
  events: Readonly<Record<string, BackgroundActivityTask>> | undefined,
  visible: boolean,
): ChatTasksState {
  const connected = useIsConnected();
  const daemonId = useSyncExternalStore(subscribeActiveDaemon, activeDaemonId);
  const subscribe = useCallback(
    (onChange: () => void) => openChatTasks(daemonId, chatId).subscribe(onChange),
    [daemonId, chatId],
  );
  const { tasks, live } = useSyncExternalStore(
    subscribe,
    () => findChatTasks(daemonId, chatId)?.state ?? NOTHING_LISTED,
  );

  // In this order: the first watch asks, knowing the connection and what it answers.
  useEffect(() => findChatTasks(daemonId, chatId)?.setConnected(connected), [daemonId, chatId, connected]);
  useEffect(() => findChatTasks(daemonId, chatId)?.setEvents(events), [daemonId, chatId, events]);
  useEffect(() => (visible ? findChatTasks(daemonId, chatId)?.watch() : undefined), [daemonId, chatId, visible]);

  return useMemo(() => ({ tasks, live: connected && live }), [tasks, connected, live]);
}
