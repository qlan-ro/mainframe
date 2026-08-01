import { useState } from 'react';
import { PanelLeftIcon, PlusIcon, SearchIcon, SettingsIcon, ZapIcon } from 'lucide-react';
import { Button } from '@v2/components/ui/button';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInput,
  SidebarRail,
  SidebarSeparator,
  useSidebar,
} from '@v2/components/ui/sidebar';
import { ProjectList } from './ProjectList';
import { SessionList } from './SessionList';

/** Reserves the native macOS traffic-lights cluster (3 × 12px + gaps + inset). */
const TRAFFIC_LIGHTS_WIDTH = 80;

function HeaderActions() {
  const { toggleSidebar } = useSidebar();

  return (
    <div className="flex items-center gap-0.5">
      <Button variant="ghost" size="icon-sm" data-testid="sidebar-workflows" title="Workflows">
        <ZapIcon />
      </Button>
      <Button variant="ghost" size="icon-sm" data-testid="sidebar-settings" title="Settings">
        <SettingsIcon />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        data-testid="sidebar-collapse"
        title="Collapse sidebar"
        onClick={toggleSidebar}
      >
        <PanelLeftIcon />
      </Button>
    </div>
  );
}

export function SessionSidebar({ className }: { className?: string }) {
  const [projectId, setProjectId] = useState<string | null>(null);
  const [activeId, setActiveId] = useState('s-2');

  return (
    <Sidebar collapsible="offcanvas" className={className}>
      <SidebarHeader className="gap-2">
        <div className="flex items-center justify-between">
          <div aria-hidden style={{ width: TRAFFIC_LIGHTS_WIDTH }} />
          <HeaderActions />
        </div>

        <div className="relative">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <SidebarInput data-testid="sidebar-search" placeholder="Search sessions" className="pl-9" />
        </div>

        <Button data-testid="sidebar-new-session" size="sm" className="w-full justify-start">
          <PlusIcon />
          New session
        </Button>
      </SidebarHeader>

      <SidebarSeparator />

      <SidebarContent>
        <ProjectList activeId={projectId} onSelect={setProjectId} />
        <SidebarSeparator />
        <SessionList projectId={projectId} activeId={activeId} onSelect={setActiveId} />
      </SidebarContent>

      <SidebarFooter className="text-xs text-muted-foreground">
        <div className="flex items-center gap-2 px-2">
          <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-primary" />
          Connected · :31415
        </div>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}
