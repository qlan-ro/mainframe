import { SessionSidebar } from '@/features/sessions/sidebar/SessionSidebar';
import { SidebarHeader } from './SidebarHeader';

/** Glass-panel sidebar: chrome header + scrollable sessions content. */
export function SidebarShell() {
  return (
    <div
      data-testid="sessions-sidebar"
      className="flex h-full w-[280px] flex-shrink-0 flex-col overflow-hidden rounded-[13px] bg-mf-glass font-sans text-foreground shadow-[0_0_0_0.5px_var(--border),0_1px_2px_rgba(0,0,0,0.04)] backdrop-blur-[40px] backdrop-saturate-[1.8] @container"
    >
      <SidebarHeader />
      <SessionSidebar />
    </div>
  );
}
