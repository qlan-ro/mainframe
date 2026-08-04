/**
 * The Tasks section of the sidebar.
 *
 * Scoped to the active project like the shipped section, and absent without
 * one. Its header parks at the bottom of the sidebar's scroll region and jumps
 * to this content when clicked — see `SidebarJumpSection`.
 *
 * The shipped header carries an expand-to-modal button; it is left out here
 * because the full Tasks board is not part of the sidebar port, and a control
 * that opens nothing is worse than a missing one.
 */
import { useState } from 'react';
import { PlusIcon } from 'lucide-react';
import { SidebarGroupContent, SidebarMenu, SidebarMenuButton, SidebarMenuItem } from '@v2/components/ui/sidebar';
import { SidebarJumpSection } from '../shared/SidebarJumpSection';
import { useActiveIdentity } from '@/features/sessions/use-active-identity';
import { useDaemonPort } from '@/features/sessions/runtime/daemon-port-context';
import { useTodosStore } from '@/features/tasks/use-todos-store';
import { useStartTodoSession } from '@/features/tasks/use-start-todo-session';
import { extractAllLabels } from '@/features/tasks/todos-filters';
import { TaskEditModal } from './TaskEditModal';
import { TasksSidebarList } from './TasksSidebarList';

export function TasksSidebarSection() {
  const { projectId } = useActiveIdentity();
  const port = useDaemonPort();
  const todos = useTodosStore((s) => s.todos);
  const startTodoSession = useStartTodoSession(port, projectId);
  const [createOpen, setCreateOpen] = useState(false);

  if (!projectId) return null;

  return (
    <>
      <SidebarJumpSection label="Tasks" testId="tasks-sidebar-section" sticky="bottom-0">
        <SidebarGroupContent>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                data-testid="tasks-sidebar-new"
                size="sm"
                onClick={() => setCreateOpen(true)}
                className="pl-5 text-muted-foreground"
              >
                <PlusIcon />
                <span className="truncate">New task</span>
              </SidebarMenuButton>
            </SidebarMenuItem>

            <TasksSidebarList
              port={port}
              projectId={projectId}
              onStartSession={(todo) => void startTodoSession(todo.id)}
            />
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarJumpSection>

      {createOpen && (
        <TaskEditModal
          port={port}
          projectId={projectId}
          todo={null}
          allTodos={todos}
          allLabels={extractAllLabels(todos)}
          onClose={() => setCreateOpen(false)}
        />
      )}
    </>
  );
}
