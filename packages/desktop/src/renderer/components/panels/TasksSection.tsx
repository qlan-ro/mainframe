import React from 'react';
import { CheckSquare, CheckCircle, Clock, Circle } from 'lucide-react';
import type { TodoItem } from '@qlan-ro/mainframe-types';

interface TasksSectionProps {
  todos: TodoItem[];
}

function StatusIcon({ status }: { status: TodoItem['status'] }) {
  switch (status) {
    case 'completed':
      return <CheckCircle size={13} className="text-green-500 shrink-0" />;
    case 'in_progress':
      return <Clock size={13} className="text-blue-400 shrink-0" />;
    default:
      return <Circle size={13} className="text-mf-text-secondary opacity-60 shrink-0" />;
  }
}

export function TasksSection({ todos }: TasksSectionProps): React.ReactElement {
  const completed = todos.filter((t) => t.status === 'completed').length;
  const total = todos.length;
  const pct = total > 0 ? (completed / total) * 100 : 0;

  return (
    <details open className="group">
      <summary className="flex items-center gap-2 px-2 py-1.5 rounded-mf-input hover:bg-mf-hover cursor-pointer text-mf-body text-mf-text-primary select-none">
        <CheckSquare size={14} className="text-mf-text-secondary shrink-0" />
        <span className="flex-1">Tasks</span>
        <span className="text-mf-status text-mf-text-secondary bg-mf-hover rounded-full px-1.5 min-w-[20px] text-center">
          {completed}/{total}
        </span>
      </summary>
      <div className="pl-2 mt-1">
        <div className="mx-2 mb-2">
          <div className="h-[3px] bg-mf-hover rounded-full overflow-hidden">
            <div
              className="h-full bg-green-500 rounded-full transition-all duration-300"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
        <div className="space-y-0.5">
          {todos.map((todo) => (
            <div key={todo.content} className="flex items-center gap-2 px-2 py-0.5 text-mf-small">
              <StatusIcon status={todo.status} />
              <span
                className={
                  todo.status === 'completed'
                    ? 'text-mf-text-secondary line-through'
                    : todo.status === 'in_progress'
                      ? 'text-blue-400'
                      : 'text-mf-text-secondary opacity-60'
                }
              >
                {todo.status === 'in_progress' ? todo.activeForm : todo.content}
              </span>
            </div>
          ))}
        </div>
      </div>
    </details>
  );
}
