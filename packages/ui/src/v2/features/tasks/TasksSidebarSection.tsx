/**
 * The Tasks section of the sidebar.
 *
 * Scoped to the active project like the shipped section, and absent without
 * one. Collapse state shares the ui-prefs entry the other sections use.
 *
 * The shipped header carries an expand-to-modal button; it is left out here
 * because the full Tasks board is not part of the sidebar port, and a control
 * that opens nothing is worse than a missing one.
 */
import { useState } from 'react';
import { ChevronRightIcon, PlusIcon } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@v2/components/ui/collapsible';
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@v2/components/ui/sidebar';
import { useActiveIdentity } from '@/features/sessions/use-active-identity';
import { useDaemonPort } from '@/features/sessions/runtime/daemon-port-context';
import { useTodosStore } from '@/features/tasks/use-todos-store';
import { useStartTodoSession } from '@/features/tasks/use-start-todo-session';
import { extractAllLabels } from '@/features/tasks/todos-filters';
import { isSidebarSectionCollapsed, useUiPrefs } from '@/store/ui-prefs';
import { TaskEditModal } from './TaskEditModal';
import { TasksSidebarList } from './TasksSidebarList';

export function TasksSidebarSection() {
  const { projectId } = useActiveIdentity();
  const port = useDaemonPort();
  const todos = useTodosStore((s) => s.todos);
  const startTodoSession = useStartTodoSession(port, projectId);
  const [createOpen, setCreateOpen] = useState(false);
  const collapsedSections = useUiPrefs((s) => s.collapsedSidebarSections);
  const toggleSection = useUiPrefs((s) => s.toggleSidebarSection);
  const open = !isSidebarSectionCollapsed(collapsedSections, 'tasks');

  if (!projectId) return null;

  return (
    <Collapsible
      open={open}
      onOpenChange={() => toggleSection('tasks')}
      data-testid="tasks-sidebar-section"
      className="group/tasks shrink-0"
    >
      <SidebarGroup className="py-0">
        <SidebarGroupLabel asChild className="pl-2">
          <CollapsibleTrigger data-testid="tasks-sidebar-section-toggle">
            <ChevronRightIcon className="transition-transform group-data-open/tasks:rotate-90" />
            Tasks
          </CollapsibleTrigger>
        </SidebarGroupLabel>

        <CollapsibleContent>
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
        </CollapsibleContent>
      </SidebarGroup>

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
    </Collapsible>
  );
}
