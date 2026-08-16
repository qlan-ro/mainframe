/**
 * The v2 left panel, fed by the real daemon thread list.
 *
 * Data flows exactly as it does in the shipped sidebar — subscribe to the stable
 * `threads.threadItems` array, project it once, then filter/group with the pure
 * view-models. Nothing here re-implements that logic; the clone is a visual
 * rebuild, so every non-visual module is imported from `@/features/sessions`.
 */
import { useMemo } from 'react';
import { useAui, useAuiState } from '@assistant-ui/react';
import { SYNTHETIC_TAGS } from '@qlan-ro/mainframe-types';
import { SettingsIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Hint } from '@/components/ui/hint';
import { Sidebar, SidebarFooter, SidebarHeader, SidebarRail, SidebarTrigger } from '@/components/ui/sidebar';
import { chordHint } from '@/features/shortcuts/chord-hint';
import type { SessionItem } from '@/features/sessions/view-model/chat-to-thread-custom';
import { regularThreadItemsToSessionItems } from '@/features/sessions/view-model/chat-to-thread-custom';
import { pickProjectSession } from '@/features/sessions/view-model/initial-session';
import { useActiveIdentity } from '@/features/sessions/use-active-identity';
import { arrangeSessions } from '@/features/sessions/view-model/group-sessions';
import { attentionCount } from '@/features/sessions/view-model/attention-counts';
import { sortProjectsByRecentActivity } from '@/features/sessions/view-model/project-activity';
import { applySessionFilters } from '@/features/sessions/filter/apply-session-filters';
import { hasSynthetic, tagsInUse } from '@/features/sessions/filter/tags-in-use';
import { useProjects } from '@/features/sessions/use-projects';
import { useAddProject } from '@/features/sessions/use-add-project';
import { useSettingsStore } from '@/store/settings';
import { useDaemonPort } from '@/features/sessions/runtime/daemon-port-context';
import { useDraftRow } from '@/features/sessions/sidebar/use-draft-row';
import { useTagRegistry } from '@/features/sessions/tags/use-tag-registry';
import { useSessionFilters } from '@/store/session-filters';
import { useUnreadStore } from '@/store/unread-store';
// The auto-updater pill (renders null unless an update exists).
import { UpdatePill } from '@/layout/UpdatePill';
import { SidebarScrollRegion } from '../shared/SidebarScrollRegion';
import { DaemonSwitcher } from '../daemon/DaemonSwitcher';
import { QuotaFooter } from '../quota/QuotaFooter';
import { ProjectSection } from './ProjectSection';
import { SessionsSection } from './SessionsSection';
import { SidebarActions } from './SidebarActions';
import { TagFilterBar } from './TagFilterBar';
import { useRemoveProject } from '@/features/sessions/use-remove-project';

/**
 * Reserves the native macOS traffic-lights cluster (3 buttons + gaps + inset).
 * The cluster's vertical centring is native too: `trafficLightPosition.y` is
 * tuned so the lights centre on this row's midline — SidebarHeader's 8px top
 * pad + the 32px icon-sm row = 24px at UI scale 1.0. Nothing recomputes that
 * y, and the y→centre mapping is SDK-gated: a binary linked against SDK ≤ 15
 * (every packaged build — the release runner is macos-14) renders the classic
 * buttons, centre = y + 2, so tauri.conf.json carries 22; a dev build linked
 * against SDK 26+ renders the new metrics, centre = y − 2, so tauri-dev.mjs
 * patches y to 26. Retune BOTH whenever this row's geometry changes, or when
 * the release runner's Xcode reaches SDK 26.
 */
const TRAFFIC_LIGHTS_WIDTH = 80;

function HeaderActions() {
  const openSettings = useSettingsStore((s) => s.open);
  const settingsHint = chordHint('app.settings');

  return (
    <div className="flex items-center gap-0.5 text-muted-foreground">
      <Hint label={settingsHint == null ? 'Settings' : `Settings · ${settingsHint}`}>
        <Button
          variant="ghost"
          size="icon-sm"
          data-testid="sidebar-settings"
          data-tut="settings"
          aria-label="Settings"
          onClick={() => openSettings()}
        >
          <SettingsIcon />
        </Button>
      </Hint>
      <Hint label="Hide sidebar">
        <SidebarTrigger data-testid="sidebar-collapse" />
      </Hint>
    </div>
  );
}

export function SessionSidebar({ className }: { className?: string }) {
  const aui = useAui();
  const threadItems = useAuiState((s) => s.threads.threadItems);
  const { projectId: activeProjectId } = useActiveIdentity();

  // Project outside the selector — a fresh array inside it would loop useAuiState's Object.is.
  const allItems = useMemo<SessionItem[]>(() => regularThreadItemsToSessionItems(threadItems), [threadItems]);

  const { filterProjectId, selectedTags, selectedSynthetic, sortMode, setFilterProjectId } = useSessionFilters();

  // Selecting a project the active session does not belong to also activates
  // that project's most recent session, so dependent context (todos scope,
  // session panel) follows the selection. The filter is set FIRST: the
  // cross-project-activate reconciliation clears the filter only when the
  // activated chat's project differs from it, and here they match.
  const handleSelectProject = (id: string | null) => {
    setFilterProjectId(id);
    if (id === null || id === activeProjectId) return;
    const target = pickProjectSession(allItems, id);
    if (target !== null) aui.threads.switchToThread(target);
  };
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
        {/* data-drag-region: the traffic-light strip is title-bar chrome — its
            empty run drags the window (buttons are auto-excluded by the host
            handler, so Settings/collapse still click). */}
        <div data-drag-region className="flex items-center justify-between">
          {/* The pill rides with the traffic lights: update chrome reads as
              window chrome, and the row's slack stays a drag region. gap-1.5
              keeps it clear of the zoom button, whose hit rect ends at 80px
              under the new-SDK metrics — flush with the reserve. */}
          <div className="flex min-w-0 items-center gap-1.5">
            <div aria-hidden className="shrink-0" style={{ width: TRAFFIC_LIGHTS_WIDTH }} />
            <UpdatePill />
          </div>
          <HeaderActions />
        </div>
        <SidebarActions filterProjectId={filterProjectId} />
        <ProjectSection
          projects={sortedProjects}
          attention={attention}
          activeId={filterProjectId}
          onSelect={handleSelectProject}
          onRemoveProject={onRemoveProject}
          onAddProject={() => void onAddProject()}
        />
      </SidebarHeader>

      <SidebarScrollRegion tut="sessions-list">
        <SessionsSection
          groups={groups}
          projectNames={projectNames}
          colorOf={registry.colorOf}
          draft={draft}
          hasFilters={hasFilters}
        />
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
