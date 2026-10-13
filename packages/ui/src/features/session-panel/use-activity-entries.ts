import { useEffect, useMemo, useState } from 'react';
import { useAuiState } from '@assistant-ui/react';
import type { BackgroundActivityTask, BackgroundTask } from '@qlan-ro/mainframe-types';
import { useChatExtras } from '@/features/chat/runtime/chat-extras';
import { useSessionItems } from '@/features/chat/orchestration/use-session-items';
import { delegatedTasksOf } from '@/features/sessions/view-model/agent-provenance';
import { listBackgroundTasks } from '@/lib/api/background-tasks';
import { anchorEntries, delegatedEntries, scheduledEntries, taskEntries, transcriptTools } from './activity-model';
import { useNow } from './background-activity-view';

function mergedTasks(
  listed: BackgroundTask[],
  liveTasks?: Readonly<Record<string, BackgroundActivityTask>>,
): BackgroundTask[] {
  const byId = new Map(listed.map((task) => [task.id, task]));
  for (const live of Object.values(liveTasks ?? {})) {
    if (byId.has(live.id)) continue;
    byId.set(live.id, {
      id: live.id,
      kind: live.kind,
      toolName: 'Bash',
      toolUseId: '',
      command: '',
      description: live.description,
      outputPath: null,
      startedAt: live.startedAt,
      endedAt: null,
      status: 'running',
      lastOutputLine: null,
      summary: null,
      usage: null,
      workflowName: live.workflowName,
      runId: live.runId,
    });
  }
  return [...byId.values()];
}

export function useActivityEntries() {
  const messages = useAuiState((state) => state.thread.messages);
  const extras = useChatExtras();
  const sessionItems = useSessionItems();
  const chatId = extras?.state.chatId;
  const liveTasks = extras?.state.backgroundTasks;
  const [loaded, setLoaded] = useState<{ chatId: string; tasks: BackgroundTask[] } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const now = useNow(true);

  useEffect(() => {
    if (!chatId || chatId.startsWith('__LOCALID_')) return;
    let active = true;
    listBackgroundTasks(chatId).then(
      (tasks) => {
        if (active) {
          setLoaded({ chatId, tasks });
          setLoadError(null);
        }
      },
      (error: unknown) => {
        if (active) setLoadError(error instanceof Error ? error.message : String(error));
      },
    );
    return () => {
      active = false;
    };
  }, [chatId, liveTasks]);

  const entries = useMemo(() => {
    const tools = transcriptTools(messages);
    const listed = loaded?.chatId === chatId ? (loaded?.tasks ?? []) : [];
    const delegated = chatId ? delegatedTasksOf(sessionItems, chatId) : [];
    return anchorEntries(
      [
        ...taskEntries(mergedTasks(listed, liveTasks), tools),
        ...delegatedEntries(delegated, tools),
        ...scheduledEntries(tools),
      ],
      messages,
    ).sort((a, b) => b.startedAt - a.startedAt);
  }, [messages, loaded, chatId, liveTasks, sessionItems]);

  return { entries, chatId, adapterId: extras?.state.chatConfig?.adapterId, loadError, now };
}
