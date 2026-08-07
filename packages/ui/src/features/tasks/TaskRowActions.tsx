/**
 * TaskRowActions — the hover-revealed action cluster of a list-view task row.
 *
 * Extracted from TaskListRow so the row stays under the file-size limit as the
 * GitHub pairing affordances land alongside it.
 */
import React from 'react';
import { Play, Edit, Trash2 } from 'lucide-react';
import { Tooltip, TooltipTrigger, TooltipContent } from '@v2/components/ui/tooltip';
import type { Todo } from '@/lib/api/todos';
import { UnlinkPairButton } from './github/UnlinkPairButton';

interface Props {
  todo: Todo;
  onEdit: (todo: Todo) => void;
  onStartSession: (todo: Todo) => void;
  onDelete: (id: string) => void;
}

export function TaskRowActions({ todo, onEdit, onStartSession, onDelete }: Props): React.ReactElement {
  const canStart = todo.status === 'open' || todo.status === 'in_progress';

  return (
    <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity ml-1">
      <UnlinkPairButton todo={todo} surface="list" />
      {canStart && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              data-testid={`tasks-list-row-start-${todo.number}`}
              onClick={(e) => {
                e.stopPropagation();
                onStartSession(todo);
              }}
              className="p-1.5 rounded text-primary hover:bg-accent transition-colors"
              aria-label="Start in new session"
            >
              <Play size={14} />
            </button>
          </TooltipTrigger>
          <TooltipContent>Start session</TooltipContent>
        </Tooltip>
      )}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            data-testid={`tasks-list-row-edit-${todo.number}`}
            onClick={(e) => {
              e.stopPropagation();
              onEdit(todo);
            }}
            className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            aria-label="Edit task"
          >
            <Edit size={14} />
          </button>
        </TooltipTrigger>
        <TooltipContent>Edit</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            data-testid={`tasks-list-row-delete-${todo.number}`}
            onClick={(e) => {
              e.stopPropagation();
              onDelete(todo.id);
            }}
            className="p-1.5 rounded text-muted-foreground hover:text-destructive hover:bg-accent transition-colors"
            aria-label="Delete task"
          >
            <Trash2 size={14} />
          </button>
        </TooltipTrigger>
        <TooltipContent>Delete</TooltipContent>
      </Tooltip>
    </div>
  );
}
