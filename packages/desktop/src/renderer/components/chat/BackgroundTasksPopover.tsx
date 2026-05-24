import React, { useState, useCallback } from 'react';
import { Square, Eye } from 'lucide-react';
import type { BackgroundTask } from '@qlan-ro/mainframe-types';
import { killBackgroundTaskApi, getBackgroundTaskOutput } from '../../lib/api/background-tasks-api.js';

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

function statusDotClass(status: BackgroundTask['status']): string {
  switch (status) {
    case 'running':
      return 'bg-mf-accent animate-pulse';
    case 'completed':
      return 'bg-mf-text-secondary';
    case 'failed':
    case 'stopped':
      return 'bg-mf-destructive';
  }
}

function viewTooltip(t: BackgroundTask): string {
  if (t.outputPath) return 'View output';
  if (t.status === 'running') return 'output available after completion';
  return 'output unavailable — task was killed before completion';
}

export function BackgroundTasksPopover({ chatId, tasks }: Props): React.ReactElement {
  const [viewing, setViewing] = useState<{ taskId: string; content: string } | null>(null);

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

  const onView = useCallback(
    async (taskId: string) => {
      try {
        const content = await getBackgroundTaskOutput(chatId, taskId);
        setViewing({ taskId, content });
      } catch (err) {
        console.warn('[bg-tasks] view failed', err);
      }
    },
    [chatId],
  );

  return (
    <div
      data-testid="chat-session-bar-bg-tasks-popover"
      className="flex flex-col w-96 max-h-96 overflow-y-auto bg-mf-panel-bg border border-mf-divider rounded shadow-lg"
    >
      {tasks.map((task) => (
        <div
          key={task.id}
          data-testid={`bg-task-row-${task.id}`}
          className="flex items-center gap-2 px-3 py-2 border-b border-mf-divider last:border-b-0 hover:bg-mf-hover"
        >
          <span className={`w-2 h-2 rounded-full shrink-0 ${statusDotClass(task.status)}`} />
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
            data-testid={`bg-task-view-${task.id}`}
            onClick={() => onView(task.id)}
            disabled={!task.outputPath}
            title={viewTooltip(task)}
            className="p-1 rounded hover:bg-mf-hover disabled:opacity-30"
          >
            <Eye size={12} />
          </button>
          <button
            data-testid={`bg-task-kill-${task.id}`}
            onClick={() => onKill(task.id)}
            disabled={task.status !== 'running'}
            title={task.status === 'running' ? 'Kill task' : 'Task is not running'}
            className="p-1 rounded hover:bg-mf-hover text-mf-destructive disabled:opacity-30"
          >
            <Square size={12} />
          </button>
        </div>
      ))}
      {viewing && (
        <div className="border-t border-mf-divider p-3 bg-mf-app-bg">
          <div className="flex items-center justify-between mb-1">
            <span className="text-mf-small text-mf-text-secondary">Output ({viewing.taskId})</span>
            <button
              data-testid="bg-task-view-close"
              onClick={() => setViewing(null)}
              className="text-mf-small text-mf-text-secondary hover:text-mf-text-primary"
            >
              Close
            </button>
          </div>
          <pre className="text-mf-small text-mf-text-primary font-mono whitespace-pre-wrap max-h-48 overflow-auto">
            {viewing.content}
          </pre>
        </div>
      )}
    </div>
  );
}
