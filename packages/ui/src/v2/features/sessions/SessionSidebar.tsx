/**
 * The v2 left panel, fed by the real daemon thread list.
 *
 * Data flows exactly as it does in the shipped sidebar — subscribe to the stable
 * `threads.threadItems` array, project it once, then filter/group with the pure
 * view-models. Nothing here re-implements that logic; the clone is a visual
 * rebuild, so every non-visual module is imported from `@/features/sessions`.
 */
import { useMemo } from 'react';
import { useAuiState } from '@assistant-ui/react';
import { PanelLeftIcon, SearchIcon, SettingsIcon, ZapIcon } from 'lucide-react';
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
import type { SessionItem } from '@/features/sessions/view-model/chat-to-thread-custom';
import { regularThreadItemsToSessionItems } from '@/features/sessions/view-model/chat-to-thread-custom';
import { arrangeSessions } from '@/features/sessions/view-model/group-sessions';
import { attentionCount } from '@/features/sessions/view-model/attention-counts';
import { sortProjectsByRecentActivity } from '@/features/sessions/view-model/project-activity';
import { applySessionFilters } from '@/features/sessions/filter/apply-session-filters';
import { useProjects } from '@/features/sessions/use-projects';
import { useDaemonPort } from '@/features/sessions/runtime/daemon-port-context';
import { useDraftRow } from '@/features/sessions/sidebar/use-draft-row';
import { useSessionCounts } from '@/features/sessions/sidebar/use-session-counts';
import { useTagRegistry } from '@/features/sessions/tags/use-tag-registry';
import { useSessionFilters } from '@/store/session-filters';
import { useUnreadStore } from '@/store/unread-store';
import { TasksSidebarSection } from '../tasks/TasksSidebarSection';
import { ProjectSection } from './ProjectSection';
import { SessionsSection } from './SessionsSection';
import { TagFilterBar } from './TagFilterBar';
import { useRemoveProject } from './use-remove-project';

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
  const threadItems = useAuiState((s) => s.threads.threadItems);

  // Project outside the selector — a fresh array inside it would loop useAuiState's Object.is.
  const allItems = useMemo<SessionItem[]>(() => regularThreadItemsToSessionItems(threadItems), [threadItems]);

  const { filterProjectId, selectedTags, selectedSynthetic, sortMode, setFilterProjectId } = useSessionFilters();
  const hasFilters = filterProjectId != null || selectedTags.size > 0 || selectedSynthetic.size > 0;
  const isUnread = useUnreadStore((s) => s.isUnread);
  const registry = useTagRegistry(useDaemonPort());
  const { projects, removeProjectFromList } = useProjects();
  const onRemoveProject = useRemoveProject(removeProjectFromList);

  const filteredItems = useMemo(
    () => applySessionFilters(allItems, { filterProjectId, selectedTags, selectedSynthetic }),
    [allItems, filterProjectId, selectedTags, selectedSynthetic],
  );

  const sortedProjects = useMemo(() => sortProjectsByRecentActivity(projects, allItems), [projects, allItems]);

  const attention = useMemo(() => {
    const map: Record<string, number> = {};
    for (const project of sortedProjects) map[project.id] = attentionCount(allItems, isUnread, project.id);
    return map;
  }, [allItems, sortedProjects, isUnread]);

  const groups = useMemo(
    () => arrangeSessions(filteredItems, sortMode, Date.now(), sortedProjects),
    [filteredItems, sortMode, sortedProjects],
  );

  const projectNames = useMemo(() => {
    const map: Record<string, string> = {};
    for (const project of sortedProjects) map[project.id] = project.name;
    return map;
  }, [sortedProjects]);

  const sessionCounts = useSessionCounts(allItems);
  const draft = useDraftRow(allItems, filterProjectId);

  return (
    <Sidebar collapsible="offcanvas" className={className}>
      <SidebarHeader className="gap-2">
        <div className="flex items-center justify-between">
          <div aria-hidden style={{ width: TRAFFIC_LIGHTS_WIDTH }} />
          <HeaderActions />
        </div>

        <div className="relative">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <SidebarInput data-testid="sidebar-search" placeholder="Search sessions" className="pl-8" />
        </div>
      </SidebarHeader>

      <SidebarSeparator />

      {/* overflow-hidden: the sessions list is windowed and owns the only
          scroller, so the panel itself must not become a second one. */}
      <SidebarContent className="overflow-hidden">
        <ProjectSection
          projects={sortedProjects}
          attention={attention}
          activeId={filterProjectId}
          onSelect={setFilterProjectId}
          onRemoveProject={onRemoveProject}
        />
        <SidebarSeparator />
        <SessionsSection
          groups={groups}
          projectNames={projectNames}
          colorOf={registry.colorOf}
          projects={sortedProjects}
          sessionCounts={sessionCounts}
          draft={draft}
          hasFilters={hasFilters}
        />
        <TasksSidebarSection />
        <TagFilterBar items={allItems} filterProjectId={filterProjectId} registry={registry} />
      </SidebarContent>

      <SidebarFooter className="text-xs text-muted-foreground">
        <div className="flex items-center gap-2 px-2">
          <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-primary" />
          {allItems.length} sessions
        </div>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}
