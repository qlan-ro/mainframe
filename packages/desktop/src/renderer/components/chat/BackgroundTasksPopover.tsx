import React, { useCallback } from 'react';
import { Square } from 'lucide-react';
import type { BackgroundTask } from '@qlan-ro/mainframe-types';
import { killBackgroundTaskApi } from '../../lib/api/background-tasks-api.js';

interface Props {
  chatId: string;
  tasks: BackgroundTask[];
}

function ageLabel(startedAt: number, endedAt: number | null): string {
  const seconds = Math.max(0, Math.floor(((endedAt ?? Date.now()) - startedAt) / 1000));
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  return `${Math.floor(seconds / 3600)}h`;
}

export function BackgroundTasksPopover({ chatId, tasks }: Props): React.ReactElement {
  // Defensive: only render running tasks regardless of what caller passes.
  const runningTasks = tasks.filter((t) => t.status === 'running');

  const onKill = useCallback(
    async (taskId: string) => {
      try {
        await killBackgroundTaskApi(chatId, taskId);
      } catch (err) {
        console.warn('[bg-tasks] kill failed', err);
      }
    },
    [chatId],
  );

  return (
    <div
      data-testid="chat-session-bar-bg-tasks-popover"
      className="flex flex-col w-96 max-h-96 overflow-y-auto bg-mf-panel-bg border border-mf-divider rounded shadow-lg"
    >
      {runningTasks.map((task) => (
        <div
          key={task.id}
          data-testid={`bg-task-row-${task.id}`}
          className="flex items-center gap-2 px-3 py-2 border-b border-mf-divider last:border-b-0 hover:bg-mf-hover"
        >
          <span className="w-2 h-2 rounded-full shrink-0 bg-mf-accent animate-pulse" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between">
              <span className="font-mono text-mf-small text-mf-text-primary truncate" title={task.command}>
                {task.command}
              </span>
              <span className="text-mf-small text-mf-text-secondary shrink-0 ml-2">
                {ageLabel(task.startedAt, task.endedAt)}
              </span>
            </div>
            {task.lastOutputLine && (
              <div className="text-mf-small text-mf-text-secondary truncate">{task.lastOutputLine}</div>
            )}
          </div>
          <button
            data-testid={`bg-task-kill-${task.id}`}
            onClick={() => onKill(task.id)}
            title="Kill task"
            className="p-1 rounded hover:bg-mf-hover text-mf-destructive"
          >
            <Square size={12} />
          </button>
        </div>
      ))}
    </div>
  );
}
