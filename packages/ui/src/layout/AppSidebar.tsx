/**
 * AppSidebar — the sidebar as a VIEW HOST. The nav rail chooses which list it
 * shows (`sidebarView` in ui-prefs); this renders that view's header + body
 * inside the one `Sidebar` shell and keeps the footer — usage rows, a
 * hairline, the device — shared across all three. Only composition lives
 * here; each view owns its own data.
 */
import { Sidebar, SidebarFooter, SidebarRail } from '@/components/ui/sidebar';
import { AutomationsSidebarList } from '@/features/automations/sidebar-list/AutomationsSidebarList';
import { DaemonSwitcher } from '@/features/daemon/DaemonSwitcher';
import { QuotaFooter } from '@/features/quota/QuotaFooter';
import { SessionSidebar } from '@/features/sessions/SessionSidebar';
import { TasksSidebarList } from '@/features/tasks/sidebar-list/TasksSidebarList';
import { useUiPrefs, type SidebarView } from '@/store/ui-prefs';

function SidebarViewBody({ view }: { view: SidebarView }) {
  switch (view) {
    case 'tasks':
      return <TasksSidebarList />;
    case 'automations':
      return <AutomationsSidebarList />;
    case 'chats':
      return <SessionSidebar />;
  }
}

export function AppSidebar() {
  const view = useUiPrefs((s) => s.sidebarView);
  return (
    <Sidebar collapsible="offcanvas" data-view={view}>
      <SidebarViewBody view={view} />
      {/* Usage rows, a hairline, then the device: the rule is load-bearing, not
          decoration — the footer butts straight up against a parked section
          header, and without it the rows read as that section's content. */}
      <SidebarFooter className="gap-1 border-t border-sidebar-border">
        <QuotaFooter />
        <div className="border-t border-sidebar-border" />
        <DaemonSwitcher />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
