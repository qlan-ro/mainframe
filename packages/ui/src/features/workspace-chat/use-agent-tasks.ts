/** The daemon's task list of one agent's call, for as long as its tab is in front. */
import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import type { BackgroundActivityTask } from '@qlan-ro/mainframe-types';
import { useIsConnected } from '@/app/ConnectionStatusContext';
import { getActiveDaemon, subscribeActiveDaemon } from '@/lib/daemon/active-daemon';
import type { AgentTasks } from './agent-status';
import { findChatTasks, NOTHING_LISTED, openChatTasks } from './chat-tasks';

const activeDaemonId = () => getActiveDaemon().id;

export function useAgentTasks(
  chatId: string,
  toolCallId: string,
  /** A new object per background event. */
  events: Readonly<Record<string, BackgroundActivityTask>> | undefined,
  visible: boolean,
): { tasks: AgentTasks; live: boolean } {
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

  const own = useMemo(() => tasks?.filter((task) => task.toolUseId === toolCallId) ?? null, [tasks, toolCallId]);
  return { tasks: own, live: connected && live };
}
