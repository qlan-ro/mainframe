/**
 * SessionSidebar — the full left panel shell (warm-chrome glass panel).
 *
 * Composition (matches the 02-chrome artboard Sidebar):
 *   header → ProjectFilterPillBar (the project switcher — "All projects" is
 *   its own top row, so no separate "Projects" section title is needed) →
 *   "Sessions" group header (chevron + count + new/sort/more) → scrollable
 *   TIME-grouped list (flex-1) → flexible spacer → bottom utility cluster:
 *   TasksSidebarSection (capped backlog preview) → TagFilterBar, glued to
 *   the daemon selector footer below
 *
 * Grouping is by TIME, not project (Pinned / Today / Yesterday / Earlier), with a
 * Sort By menu (Recent / Name / Status) — per the artboard `arrangeSessions`.
 * Project narrowing is handled by the filter pills + the per-row project chip
 * (shown only in "All" view, i.e. when no project filter is active).
 *
 * Data:
 *   - useAssistantRuntime().threads for the native thread list (mapped via regularThreadItemsToSessionItems)
 *   - useProjects() for the project set (filter pills + per-row chip name)
 *   - useSessionFilters() for project/tag/synthetic filter state + sortMode
 *   - useUnreadStore() for attention counts
 *   - useTagRegistry() for tag color resolution (TagFilterBar swatches)
 *   - arrangeSessions / applySessionFilters / attentionCount (pure VMs)
 */
import { memo, useCallback, useMemo } from 'react';
import { useAssistantRuntime, useAuiState } from '@assistant-ui/react';
import { mfToast } from '@/lib/toast';
import type { SessionItem } from '../view-model/chat-to-thread-custom';
import { regularThreadItemsToSessionItems } from '../view-model/chat-to-thread-custom';
import { arrangeSessions } from '../view-model/group-sessions';
import { attentionCount } from '../view-model/attention-counts';
import { sortProjectsByRecentActivity } from '../view-model/project-activity';
import { applySessionFilters } from '../filter/apply-session-filters';
import { useSessionFilters } from '@/store/session-filters';
import { useUnreadStore } from '@/store/unread-store';
import { useLastSessionStore } from '@/store/last-session';
import { useProjects } from '../use-projects';
import { useAddProject } from '../use-add-project';
import { SessionListVirtuoso } from './SessionListVirtuoso';
import { SessionRow } from './SessionRow';
import { SessionSortMenu } from './SessionSortMenu';
import { SessionsMoreMenu } from './SessionsMoreMenu';
import { SessionsNewButton } from './SessionsNewButton';
import { DraftSessionRow } from './DraftSessionRow';
import { useDraftRow } from './use-draft-row';
import { useSessionCounts } from './use-session-counts';
import { ProjectFilterPillBar } from './ProjectFilterPillBar';
import { TagFilterBar } from '../filter/TagFilterBar';
import { TasksSidebarSection } from '@/features/tasks/TasksSidebarSection';
import { useDaemonPort } from '../runtime/daemon-port-context';
import { useTagRegistry } from '../tags/use-tag-registry';
import { removeProject } from '@/lib/api/projects';
import { resolveProjectSession } from './resolve-project-session';
import { sidebarIndentPx, SIDEBAR_INDENT_STEP_PX } from '@/layout/sidebar-indent';
import { useUiPrefs, isSidebarSectionCollapsed } from '@/store/ui-prefs';
import { SidebarSectionChevron } from '@/layout/SidebarSectionChevron';

function EmptyState({ hasFilters }: { hasFilters: boolean }) {
  return (
    <div data-testid="sessions-empty-state" className="px-3 py-5 text-center text-body text-muted-foreground">
      {hasFilters ? 'No sessions match these filters.' : 'No sessions yet'}
    </div>
  );
}

/**
 * SessionsGroupHeader — the sticky "SESSIONS" group header with the sort/more
 * icon-button cluster. New-session entry is its own full-width row underneath
 * (SessionsNewButton), not a header icon; the sort button opens
 * SessionSortMenu; the more (⋯) button opens SessionsMoreMenu (Archived
 * sessions · Import external sessions). The chevron/label are a separate
 * button from the sort/more cluster (siblings, not nested) — collapsing the
 * section still leaves those header-level actions reachable, matching how a
 * collapsed Finder/Mail section keeps its header controls live.
 */
function SessionsGroupHeader({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const { sortMode, setSortMode } = useSessionFilters();
  return (
    <div
      style={{ paddingLeft: sidebarIndentPx(0), paddingRight: sidebarIndentPx(0) }}
      className="flex items-center gap-[4px] pb-1 pt-[8px]"
    >
      <button
        type="button"
        data-testid="sessions-section-toggle"
        aria-expanded={open}
        onClick={onToggle}
        className="flex items-center gap-[4px]"
      >
        <SidebarSectionChevron open={open} />
        <span className="text-caption font-medium text-muted-foreground">Sessions</span>
      </button>
      <div className="flex-1" />
      <SessionSortMenu mode={sortMode} onChange={setSortMode} />
      <SessionsMoreMenu />
    </div>
  );
}

function buildAttentionMap(
  items: SessionItem[],
  projects: { id: string }[],
  isUnread: (id: string) => boolean,
): Record<string, number> {
  const map: Record<string, number> = {};
  for (const p of projects) {
    map[p.id] = attentionCount(items, isUnread, p.id);
  }
  return map;
}

function SessionSidebarImpl() {
  const runtime = useAssistantRuntime();
  // Reactive + memoized. Subscribe to the stable store-scope threadItems array and
  // project ONCE (memoized on it). Previously this read `runtime.threads.getState()`
  // imperatively on every render — a fresh array each time, which defeated every
  // downstream useMemo (filter/group/attention) AND left the list non-reactive
  // (it only refreshed when a parent re-rendered). Mirrors useSessionListRouter.
  const threadItems = useAuiState((s) => s.threads.threadItems);
  // Regular-only: the store-scope `threadItems` includes archived sessions
  // (aui keeps them in the same map, splitting only the id buckets), so project
  // through the regular filter — the archived list has its own dialog. Feeds the
  // list AND every aggregate below (attention counts, project sort), which must
  // all be over the visible set.
  const allItems = useMemo<SessionItem[]>(() => regularThreadItemsToSessionItems(threadItems), [threadItems]);
  const { filterProjectId, selectedTags, selectedSynthetic, sortMode, setFilterProjectId } = useSessionFilters();
  const isUnread = useUnreadStore((s) => s.isUnread);
  const { projects, reloadProjects, removeProjectFromList } = useProjects();
  const port = useDaemonPort();
  const registry = useTagRegistry(port);

  const filteredItems = useMemo(
    () => applySessionFilters(allItems, { filterProjectId, selectedTags, selectedSynthetic }),
    [allItems, filterProjectId, selectedTags, selectedSynthetic],
  );

  const projectNameOf = useMemo(() => {
    const map = new Map(projects.map((p) => [p.id, p.name]));
    return (projectId: string): string => map.get(projectId) ?? projectId;
  }, [projects]);

  const attentionCounts = useMemo(
    () => buildAttentionMap(allItems, projects, isUnread),
    [allItems, projects, isUnread],
  );

  const sortedProjects = useMemo(() => sortProjectsByRecentActivity(projects, allItems), [projects, allItems]);

  // 'project' mode groups by the sidebar's own project order (sortedProjects),
  // not raw daemon order — matches the switcher list above it.
  const groups = useMemo(
    () => arrangeSessions(filteredItems, sortMode, Date.now(), sortedProjects),
    [filteredItems, sortMode, sortedProjects],
  );

  const sessionCounts = useSessionCounts(allItems);
  const draftRow = useDraftRow(allItems, filterProjectId);
  const filterProjectName = filterProjectId != null ? projectNameOf(filterProjectId) : null;
  const collapsedSections = useUiPrefs((s) => s.collapsedSidebarSections);
  const toggleSidebarSection = useUiPrefs((s) => s.toggleSidebarSection);
  const sessionsOpen = !isSidebarSectionCollapsed(collapsedSections, 'sessions');

  // Selecting a project pill sets the filter AND activates that project's
  // most-recent (or remembered) session. When the project has no sessions,
  // open a new-thread draft so the chat pane reflects the empty project
  // instead of stranding the previous project's session. Toggling OFF only
  // clears the filter.
  const onSelectProject = useCallback(
    (projectId: string | null) => {
      setFilterProjectId(projectId);
      if (projectId != null) {
        const target = resolveProjectSession(allItems, projectId, useLastSessionStore.getState().lastByProject);
        if (target != null) {
          runtime.threads.switchToThread(target);
        } else {
          void runtime.threads.switchToNewThread();
        }
      }
    },
    [allItems, runtime, setFilterProjectId],
  );

  const handleRemoveProject = useCallback(
    async (project: { id: string; name: string }) => {
      const confirmed = window.confirm(
        `Remove project "${project.name}"?\n\nThis will stop all its sessions and remove the project from the database. Files on disk are NOT affected.\n\nThis cannot be undone.`,
      );
      if (!confirmed) return;

      try {
        await removeProject(port, project.id);
        removeProjectFromList(project.id);
        if (filterProjectId === project.id) setFilterProjectId(null);
        mfToast.success('Project removed', { description: project.name });
      } catch (error) {
        console.warn('[sessions] remove project failed', error);
        mfToast.error('Failed to remove project', {
          description: error instanceof Error ? error.message : String(error),
        });
      }
    },
    [filterProjectId, port, removeProjectFromList, setFilterProjectId],
  );

  const handleAddProject = useAddProject(reloadProjects);

  // Project chip on each row only in "All" view (no active project filter); the
  // filter pill already narrows the list when a project is selected.
  const showProject = filterProjectId == null;
  const hasFilters = filterProjectId != null || selectedTags.size > 0 || selectedSynthetic.size > 0;

  return (
    <>
      <ProjectFilterPillBar
        projects={sortedProjects}
        filterProjectId={filterProjectId}
        attentionCounts={attentionCounts}
        onSelect={onSelectProject}
        onRemoveProject={(project) => void handleRemoveProject(project)}
        onAddProject={() => void handleAddProject()}
      />

      <SessionsGroupHeader open={sessionsOpen} onToggle={() => toggleSidebarSection('sessions')} />

      {sessionsOpen && (
        <>
          <div className="pr-2" style={{ paddingLeft: SIDEBAR_INDENT_STEP_PX }}>
            <SessionsNewButton
              filterProjectId={filterProjectId}
              filterProjectName={filterProjectName}
              projects={sortedProjects}
              sessionCounts={sessionCounts}
              onAddProject={() => void handleAddProject()}
            />
          </div>

          {draftRow.visible && draftRow.model != null && (
            <DraftSessionRow
              projectId={draftRow.model.projectId}
              projectName={projectNameOf(draftRow.model.projectId)}
              selected={draftRow.selected}
              showProject={showProject}
              onSelect={draftRow.onSelect}
              onDiscard={draftRow.onDiscard}
            />
          )}

          {filteredItems.length === 0 ? (
            <div
              className="overscroll-contain min-h-0 flex-1 overflow-y-auto bg-transparent py-0.5"
              data-testid="sessions-list-scroll"
            >
              <EmptyState hasFilters={hasFilters} />
            </div>
          ) : (
            <SessionListVirtuoso
              groups={groups}
              showProject={showProject}
              renderItem={(item, flags) => (
                <SessionRow
                  key={item.id}
                  item={item}
                  colorOf={registry.colorOf}
                  inPinnedGroup={flags.inPinnedGroup}
                  projectName={flags.showProject ? projectNameOf(item.custom.projectId) : undefined}
                />
              )}
            />
          )}
        </>
      )}

      {/* Flexible gap (not a fixed margin): absorbs whatever vertical space
          Projects/Sessions don't use, so Tasks + Tags + the daemon selector
          (SidebarFooter, rendered by SidebarShell right after this component)
          stay glued together as one bottom-anchored cluster instead of the
          footer floating up flush against Tags on a short list. A fixed
          margin here can't do that — it neither grows to absorb slack nor
          shrinks below itself, so it always leaves a footer-sized dead zone
          either above or below the cluster depending on content length. */}
      <div className="min-h-3 flex-1" aria-hidden="true" />

      {/* Bottom utility cluster: navigation (Projects/Sessions) flows from the
          top; secondary project sections (Tasks backlog preview, tag filters)
          anchor at the bottom with the daemon selector — the Finder/Mail
          split of primary collections vs. end-of-sidebar utility sections. */}
      <TasksSidebarSection />

      <TagFilterBar items={allItems} filterProjectId={filterProjectId} registry={registry} />
    </>
  );
}

// Memoized: SessionSidebar takes no props, so it re-renders only from its OWN
// reactive subscriptions (threadItems / filters / projects), NOT every time the
// parent RuntimeBody re-renders — which happens on every sidebar-resize pixel and
// every session switch. Without this boundary those parent re-renders would re-run
// the whole session-list render + all SessionRows each frame.
export const SessionSidebar = memo(SessionSidebarImpl);
