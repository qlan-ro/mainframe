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
import { SYNTHETIC_TAGS } from '@qlan-ro/mainframe-types';
import { ListTodoIcon, SettingsIcon, ZapIcon } from 'lucide-react';
import { Button } from '@v2/components/ui/button';
import { Sidebar, SidebarFooter, SidebarHeader, SidebarRail, SidebarTrigger } from '@v2/components/ui/sidebar';
import type { SessionItem } from '@/features/sessions/view-model/chat-to-thread-custom';
import { regularThreadItemsToSessionItems } from '@/features/sessions/view-model/chat-to-thread-custom';
import { arrangeSessions } from '@/features/sessions/view-model/group-sessions';
import { attentionCount } from '@/features/sessions/view-model/attention-counts';
import { sortProjectsByRecentActivity } from '@/features/sessions/view-model/project-activity';
import { applySessionFilters } from '@/features/sessions/filter/apply-session-filters';
import { hasSynthetic, tagsInUse } from '@/features/sessions/filter/tags-in-use';
import { useProjects } from '@/features/sessions/use-projects';
import { useAddProject } from '@/features/sessions/use-add-project';
import { useAutomationsNav } from '@/features/automations/data/use-automations-nav';
import { selectPendingInteractionCount, useAutomationsStore } from '@/features/automations/data/use-automations-store';
import { useSettingsStore } from '@/store/settings';
import { useDaemonPort } from '@/features/sessions/runtime/daemon-port-context';
import { useDraftRow } from '@/features/sessions/sidebar/use-draft-row';
import { useSessionCounts } from '@/features/sessions/sidebar/use-session-counts';
import { useTagRegistry } from '@/features/sessions/tags/use-tag-registry';
import { useSessionFilters } from '@/store/session-filters';
import { useUnreadStore } from '@/store/unread-store';
// The auto-updater pill (renders null unless an update exists).
import { UpdatePill } from '@/layout/UpdatePill';
import { SidebarScrollRegion } from '../shared/SidebarScrollRegion';
import { DaemonSwitcher } from '../daemon/DaemonSwitcher';
import { QuotaFooter } from '../quota/QuotaFooter';
import { TasksSidebarSection } from '../tasks/TasksSidebarSection';
import { ProjectSection } from './ProjectSection';
import { SessionsSection } from './SessionsSection';
import { TagFilterBar } from './TagFilterBar';
import { useRemoveProject } from '@/features/sessions/use-remove-project';

/** Reserves the native macOS traffic-lights cluster (3 × 12px + gaps + inset). */
const TRAFFIC_LIGHTS_WIDTH = 80;

function HeaderActions() {
  const pendingAutomations = useAutomationsStore(selectPendingInteractionCount);
  const openAutomations = useAutomationsNav((s) => s.openHost);
  const openSettings = useSettingsStore((s) => s.open);

  return (
    <div className="flex items-center gap-0.5 text-muted-foreground">
      <Button
        variant="ghost"
        size="icon-sm"
        className="relative"
        data-testid="sidebar-workflows"
        title="Workflows"
        onClick={openAutomations}
      >
        <ZapIcon />
        {pendingAutomations > 0 && (
          <span
            data-testid="sidebar-workflows-pending"
            className="absolute top-0.5 right-0.5 size-1.5 rounded-full bg-primary"
          />
        )}
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        data-testid="sidebar-tasks"
        title="Tasks"
        // The todos board host (TasksModalHost, mounted at the app root)
        // listens for this window event; there is no store seam to call.
        onClick={() => window.dispatchEvent(new CustomEvent('mf:open-tasks'))}
      >
        <ListTodoIcon />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        data-testid="sidebar-settings"
        title="Settings · ⌘,"
        onClick={() => openSettings()}
      >
        <SettingsIcon />
      </Button>
      <SidebarTrigger data-testid="sidebar-collapse" title="Hide sidebar" />
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
  const { projects, removeProjectFromList, reloadProjects } = useProjects();
  const onRemoveProject = useRemoveProject(removeProjectFromList);
  const onAddProject = useAddProject(reloadProjects);

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

  const tagNames = useMemo(() => tagsInUse(allItems, filterProjectId), [allItems, filterProjectId]);
  const syntheticTags = useMemo(() => SYNTHETIC_TAGS.filter((kind) => hasSynthetic(allItems, kind)), [allItems]);
  const showTags = tagNames.length > 0 || syntheticTags.length > 0;

  return (
    <Sidebar collapsible="offcanvas" className={className}>
      {/* The projects switcher lives here, not in the scrolling body: shadcn
          documents the header as the home for a workspace switcher, and it is
          the one thing a long session list must not scroll away. */}
      <SidebarHeader>
        <div className="flex items-center justify-between">
          <div aria-hidden style={{ width: TRAFFIC_LIGHTS_WIDTH }} />
          <UpdatePill />
          <HeaderActions />
        </div>
        <ProjectSection
          projects={sortedProjects}
          attention={attention}
          activeId={filterProjectId}
          onSelect={setFilterProjectId}
          onRemoveProject={onRemoveProject}
          onAddProject={() => void onAddProject()}
        />
      </SidebarHeader>

      <SidebarScrollRegion>
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
      </SidebarScrollRegion>

      {/* The rule is load-bearing, not decoration: the footer butts straight up
          against a parked section header, and without it the tag chips read as
          that section's content. */}
      <SidebarFooter className="border-t border-sidebar-border">
        {showTags && <TagFilterBar inUse={tagNames} synthetic={syntheticTags} registry={registry} />}
        <QuotaFooter />
        <DaemonSwitcher />
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}
