/**
 * AppSidebar — the sidebar as a VIEW HOST. The nav rail chooses which list it
 * shows (`sidebarView` in ui-prefs); this renders that view's header + body
 * inside the one `Sidebar` shell. Plan usage lives in the title bar's usage
 * capsule, so the panel has no footer. Only composition lives here; each view
 * owns its own data.
 */
import { Sidebar, SidebarRail } from '@/components/ui/sidebar';
import { AutomationsSidebarList } from '@/features/automations/sidebar-list/AutomationsSidebarList';
import { AdvisorSidebarList } from '@/features/setup-advisor/AdvisorSidebarList';
import { SessionSidebar } from '@/features/sessions/SessionSidebar';
import { SettingsSidebar } from '@/features/settings/SettingsSidebar';
import { TasksSidebarList } from '@/features/tasks/sidebar-list/TasksSidebarList';
import { useUiPrefs, type SidebarView } from '@/store/ui-prefs';

function SidebarViewBody({ view }: { view: SidebarView }) {
  switch (view) {
    case 'tasks':
      return <TasksSidebarList />;
    case 'automations':
      return <AutomationsSidebarList />;
    case 'advisor':
      return <AdvisorSidebarList />;
    case 'settings':
      return <SettingsSidebar />;
    case 'chats':
      return <SessionSidebar />;
  }
}

export function AppSidebar() {
  const view = useUiPrefs((s) => s.sidebarView);
  return (
    // The panel sits on the content card's ground, not the chrome's: only the
    // rail and the title bar keep `sidebar`. Re-pointing the variable here (not
    // swapping classes) carries every `bg-sidebar` / `var(--sidebar)` inside
    // with it — sticky group headers, the scope avatars' cut-out borders.
    <Sidebar
      collapsible="offcanvas"
      data-view={view}
      style={{ '--sidebar': 'var(--background)' } as React.CSSProperties}
    >
      <SidebarViewBody view={view} />
      <SidebarRail />
    </Sidebar>
  );
}
