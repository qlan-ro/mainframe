/**
 * The parent chat's delegated tasks, in its column header: a chip reading
 * `N tasks running · M waiting` that opens a menu of the tasks, each with its
 * live status, and switches to the child chat on select. Renders nothing for a
 * chat that never delegated. A floating list of actions, so a DropdownMenu.
 *
 * The rows come from the session list's projection of each child's
 * `Chat.delegation`, which the daemon re-announces on every task change.
 */
import { useMemo } from 'react';
import { ListChecks } from 'lucide-react';
import { useAui, useAuiState } from '@assistant-ui/react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { countTasks, delegatedTasksOf, taskChipLabel } from '@/features/sessions/view-model/agent-provenance';
import { TaskStatusLabel } from './TaskStatusLabel';
import { useSessionItems } from './use-session-items';

export function ChatHeaderTasksChip() {
  const aui = useAui();
  const chatId = useAuiState((s) => s.threadListItem?.remoteId ?? null);
  const items = useSessionItems();
  const rows = useMemo(() => (chatId == null ? [] : delegatedTasksOf(items, chatId)), [items, chatId]);
  if (rows.length === 0) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          data-testid="chat-header-tasks-chip"
          variant="ghost"
          size="xs"
          className="shrink-0 text-muted-foreground"
          onClick={(event) => event.stopPropagation()}
        >
          <ListChecks className="size-3.5" />
          {taskChipLabel(countTasks(rows))}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuLabel>Delegated tasks</DropdownMenuLabel>
        {rows.map((row) => (
          <DropdownMenuItem
            key={row.taskId}
            data-testid={`chat-header-task-row-${row.taskId}`}
            onSelect={() => aui.threads.switchToThread(row.itemId)}
          >
            <span className="min-w-0 flex-1 truncate">{row.title}</span>
            <TaskStatusLabel status={row.status} waiting={row.waiting} />
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
