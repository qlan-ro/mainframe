/**
 * The sidebar's quick actions, above the projects switcher: New Thread,
 * Kanban (the todos board) and Automations as labeled rows — the labeled
 * successors of the old header cluster's icon-only Zap/ListTodo buttons.
 *
 * New Thread mirrors SessionsNewButton's one-click semantics: with a project
 * filter active it opens that project's draft; otherwise the projectless
 * draft, whose welcome screen owns the project pick.
 */
import { SquareKanban, SquarePen, Zap } from 'lucide-react';
import { useAui } from '@assistant-ui/react';
import { SidebarGroup, SidebarMenu, SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar';
import { useAutomationsNav } from '@/features/automations/data/use-automations-nav';
import { selectPendingInteractionCount, useAutomationsStore } from '@/features/automations/data/use-automations-store';
import { resetNewThreadDraft } from './new-thread/reset-new-thread-draft';
import { useOpenDraft } from './use-open-draft';

export function SidebarActions({ filterProjectId }: { filterProjectId: string | null }) {
  const aui = useAui();
  const openDraft = useOpenDraft();
  const openAutomations = useAutomationsNav((s) => s.openHost);
  const pendingAutomations = useAutomationsStore(selectPendingInteractionCount);

  const newThread = () => {
    if (filterProjectId != null) {
      void openDraft({ projectId: filterProjectId });
      return;
    }
    resetNewThreadDraft(aui.threads.getState().newThreadId);
    void aui.threads.switchToNewThread();
  };

  return (
    <SidebarGroup className="p-0">
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton size="sm" data-testid="sidebar-action-new-thread" onClick={newThread}>
            <SquarePen className="text-muted-foreground" />
            <span className="text-muted-foreground">New Thread</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton
            size="sm"
            data-testid="sidebar-action-kanban"
            // The todos board host (TasksModalHost, mounted at the app root)
            // listens for this window event; there is no store seam to call.
            onClick={() => window.dispatchEvent(new CustomEvent('mf:open-tasks'))}
          >
            <SquareKanban className="text-muted-foreground" />
            <span className="text-muted-foreground">Kanban</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton size="sm" data-testid="sidebar-action-automations" onClick={openAutomations}>
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
