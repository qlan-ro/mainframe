import { useEffect, useMemo, useState } from 'react';
import type { BackgroundActivityTask } from '@qlan-ro/mainframe-types';
import { useIsConnected } from '@/app/ConnectionStatusContext';
import { listBackgroundTasks } from '@/lib/api/background-tasks';
import type { AgentTasks } from './agent-status';

export function useAgentTasks(
  chatId: string,
  toolCallId: string,
  live: Readonly<Record<string, BackgroundActivityTask>> | undefined,
  visible: boolean,
): { tasks: AgentTasks; fresh: boolean } {
  const connected = useIsConnected();
  const request = useMemo(
    () => ({ chatId, toolCallId, live, visible, connected }),
    [chatId, toolCallId, live, visible, connected],
  );
  const [listed, setListed] = useState<{
    chatId: string;
    toolCallId: string;
    request: object;
    tasks: AgentTasks;
  } | null>(null);
  useEffect(() => {
    if (!visible || !connected) return undefined;
    let current = true;
    listBackgroundTasks(chatId).then(
      (tasks) => {
        if (current)
          setListed({ chatId, toolCallId, request, tasks: tasks.filter((task) => task.toolUseId === toolCallId) });
      },
      (error: unknown) => console.warn('[workspace-chat] could not list background tasks', error),
    );
    return () => {
      current = false;
    };
  }, [chatId, toolCallId, request, visible, connected]);
  const sameCall = listed?.chatId === chatId && listed.toolCallId === toolCallId;
  return { tasks: sameCall ? listed.tasks : null, fresh: sameCall && listed.request === request };
}
