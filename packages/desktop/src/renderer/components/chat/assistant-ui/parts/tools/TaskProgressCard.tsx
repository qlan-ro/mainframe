import React, { useMemo } from 'react';
import { Check } from 'lucide-react';
import { cn } from '../../../../../lib/utils';
import type { TaskProgressItem } from '../../convert-message';

interface TaskState {
  id: string;
  subject: string;
  status: string;
  activeForm?: string;
}

function TaskStatusIcon({ status }: { status: string }) {
  if (status === 'completed') {
    return (
      <span className="w-3.5 h-3.5 rounded-sm bg-mf-success/20 border border-mf-success/50 flex items-center justify-center shrink-0">
        <Check size={12} className="text-mf-success" />
      </span>
    );
  }
  if (status === 'in_progress') {
    return <span className="w-3.5 h-3.5 rounded-sm bg-mf-accent border border-mf-accent shrink-0" />;
  }
  return <span className="w-3.5 h-3.5 rounded-sm border border-mf-text-secondary/30 shrink-0" />;
}

export function TaskProgressCard({ args }: { args: Record<string, unknown> }) {
  const items = (args.items as TaskProgressItem[]) || [];

  const tasks = useMemo(() => {
    const list: TaskState[] = [];
    const map = new Map<string, TaskState>();

    for (const item of items) {
      if (item.toolName === 'TaskCreate') {
        const resultStr = typeof item.result === 'string' ? item.result : '';
        const match = resultStr.match(/Task #(\d+)/);
        const id = match ? match[1]! : String(map.size + 1);
        const subject = (item.args.subject as string) || `Task #${id}`;
        const activeForm = (item.args.activeForm as string) || undefined;
        const task: TaskState = { id, subject, status: 'pending', activeForm };
        map.set(id, task);
        list.push(task);
      } else if (item.toolName === 'TaskUpdate') {
        const taskId = (item.args.taskId as string) || '';
        const newStatus = (item.args.status as string) || '';
        const existing = map.get(taskId);
        if (existing) {
          if (newStatus) existing.status = newStatus;
          if (item.args.subject) existing.subject = item.args.subject as string;
          if (item.args.activeForm) existing.activeForm = item.args.activeForm as string;
        } else if (taskId) {
          const task: TaskState = { id: taskId, subject: `Task #${taskId}`, status: newStatus || 'pending' };
          map.set(taskId, task);
          list.push(task);
        }
      }
    }

    return list.filter((t) => t.status !== 'deleted');
  }, [items]);

  if (tasks.length === 0) return null;

  return (
    <div className="space-y-0.5 py-0.5">
      {tasks.map((task) => (
        <div key={task.id} className="flex items-center gap-2 px-1 py-0.5 text-mf-body">
          <TaskStatusIcon status={task.status} />
          <span
            className={cn(
              'truncate',
              task.status === 'completed'
                ? 'text-mf-text-secondary/50 line-through'
                : task.status === 'in_progress'
                  ? 'text-mf-text-primary'
                  : 'text-mf-text-secondary',
            )}
            title={task.subject}
          >
            {task.subject}
          </span>
        </div>
      ))}
    </div>
  );
}
