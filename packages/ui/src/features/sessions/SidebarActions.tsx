/**
 * The sidebar's quick actions, above the projects switcher: New Thread,
 * Kanban (the todos board) and Automations as labeled rows — the labeled
 * successors of the old header cluster's icon-only Zap/ListTodo buttons.
 *
 * New Thread routes through the shared useStartNewSession resolver (pill →
 * active session's project → none), the same as every other "+" entry point.
 */
import { SquareKanban, SquarePen, Zap } from 'lucide-react';
import { SidebarGroup, SidebarMenu, SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar';
import { useAutomationsNav } from '@/features/automations/data/use-automations-nav';
import { selectPendingInteractionCount, useAutomationsStore } from '@/features/automations/data/use-automations-store';
import { useStartNewSession } from './new-thread/use-start-new-session';

export function SidebarActions() {
  const newThread = useStartNewSession();
  const openAutomations = useAutomationsNav((s) => s.openHost);
  const pendingAutomations = useAutomationsStore(selectPendingInteractionCount);

  return (
    <SidebarGroup className="p-0">
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton
            size="sm"
            data-testid="sidebar-action-new-thread"
            data-tut="new-session-row"
            onClick={newThread}
          >
            <SquarePen className="text-muted-foreground" />
            <span className="text-muted-foreground">New Thread</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton
            size="sm"
            data-testid="sidebar-action-kanban"
            data-tut="kanban"
            // The todos board host (TasksModalHost, mounted at the app root)
            // listens for this window event; there is no store seam to call.
            onClick={() => window.dispatchEvent(new CustomEvent('mf:open-tasks'))}
          >
            <SquareKanban className="text-muted-foreground" />
            <span className="text-muted-foreground">Kanban</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton
            size="sm"
            data-testid="sidebar-action-automations"
            data-tut="automations"
            onClick={openAutomations}
          >
            <Zap className="text-muted-foreground" />
            <span className="text-muted-foreground">Automations</span>
            {pendingAutomations > 0 && (
              <span
                data-testid="sidebar-action-automations-pending"
                className="ml-auto size-1.5 shrink-0 rounded-full bg-primary"
              />
            )}
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarGroup>
  );
}
