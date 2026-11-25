import { useEffect, useState } from 'react';
import type { BackgroundActivityTask } from '@qlan-ro/mainframe-types';
import { useIsConnected } from '@/app/ConnectionStatusContext';
import { listBackgroundTasks } from '@/lib/api/background-tasks';
import type { AgentTasks } from './agent-status';

/**
 * The background tasks behind a sub-agent's call. Null until listed: a request
 * that fails leaves what was known, and is made again on reconnecting. Read
 * again on every background event, but only for a tab the user can see.
 */
export function useAgentTasks(
  chatId: string,
  toolCallId: string,
  live: Readonly<Record<string, BackgroundActivityTask>> | undefined,
  visible: boolean,
): AgentTasks {
  const connected = useIsConnected();
  const [listed, setListed] = useState<{ key: string; tasks: AgentTasks } | null>(null);
  const key = `${chatId} ${toolCallId}`;
  useEffect(() => {
    if (!visible || !connected) return undefined;
    let current = true;
    listBackgroundTasks(chatId).then(
      (tasks) => {
        if (current) setListed({ key, tasks: tasks.filter((task) => task.toolUseId === toolCallId) });
      },
      (error: unknown) => console.warn('[workspace-chat] could not list background tasks', error),
    );
    return () => {
      current = false;
    };
  }, [chatId, toolCallId, key, live, visible, connected]);
  return listed?.key === key ? listed.tasks : null;
}
