/**
 * SessionSidebar — the full left panel shell (warm-chrome glass panel).
 *
 * Composition (matches the 02-chrome artboard Sidebar):
 *   header → "Sessions" group header (chevron + count + new/sort/more) →
 *   ProjectFilterPillBar → scrollable TIME-grouped list (flex-1) →
 *   TagFilterBar pinned at the BOTTOM (border-t, flex-shrink-0)
 *
 * Grouping is by TIME, not project (Pinned / Today / Yesterday / Earlier), with a
 * Sort By menu (Recent / Name / Status) — per the artboard `arrangeSessions`.
 * Project narrowing is handled by the filter pills + the per-row project chip
 * (shown only in "All" view, i.e. when no project filter is active).
 *
 * Data:
 *   - useAssistantRuntime().threads for the native thread list (mapped via threadListStateToSessionItems)
 *   - useProjects() for the project set (filter pills + per-row chip name)
 *   - useSessionFilters() for project/tag/synthetic filter state + sortMode
 *   - useUnreadStore() for attention counts
 *   - useTagRegistry() for tag color resolution (TagFilterBar swatches)
 *   - arrangeSessions / applySessionFilters / attentionCount (pure VMs)
 */
import { useCallback, useMemo } from 'react';
import { ThreadListPrimitive, useAssistantRuntime } from '@assistant-ui/react';
import { ChevronDown, PlusIcon } from 'lucide-react';
import { toast } from 'sonner';
import type { SessionItem } from '../view-model/chat-to-thread-custom';
import { threadListStateToSessionItems } from '../view-model/chat-to-thread-custom';
import { arrangeSessions } from '../view-model/group-sessions';
import { attentionCount } from '../view-model/attention-counts';
import { sortProjectsByRecentActivity } from '../view-model/project-activity';
import { applySessionFilters } from '../filter/apply-session-filters';
import { countByBaseStatus } from '../view-model/count-by-base-status';
import { useSessionFilters } from '@/store/session-filters';
import { useUnreadStore } from '@/store/unread-store';
import { useProjects } from '../use-projects';
import { SessionGroup } from './SessionGroup';
import { SessionRow } from './SessionRow';
import { SessionSortMenu } from './SessionSortMenu';
import { SessionsMoreMenu } from './SessionsMoreMenu';
import { ProjectFilterPillBar } from './ProjectFilterPillBar';
import { TagFilterBar } from '../filter/TagFilterBar';
import { SidebarFooter } from '@/layout/SidebarFooter';
import { useDaemonPort } from '../runtime/daemon-port-context';
import { useTagRegistry } from '../tags/use-tag-registry';
import { removeProject } from '@/lib/api/projects';

function EmptyState({ hasFilters }: { hasFilters: boolean }) {
  return (
    <div data-testid="sessions-empty-state" className="px-3 py-5 text-center text-caption text-mf-text-3">
      {hasFilters ? 'No sessions match these filters.' : 'No sessions yet'}
    </div>
  );
}

/**
 * SessionsGroupHeader — the sticky "SESSIONS" group header with the count and
 * the new/sort/more icon-button cluster. The +new button is wired to the native
 * ThreadListPrimitive.New; the sort button opens SessionSortMenu; the more (⋯)
 * button opens SessionsMoreMenu (Archived sessions · Import external sessions).
 */
function SessionsGroupHeader({ count }: { count: number }) {
  const { sortMode, setSortMode } = useSessionFilters();
  const iconBtn =
    'inline-flex size-[22px] items-center justify-center rounded-[6px] text-mf-text-3 transition-colors hover:bg-accent hover:text-foreground';
  return (
    <div className="flex items-center gap-[4px] px-[12px] pb-1 pt-[8px]">
      <ChevronDown size={10} className="shrink-0 text-mf-text-3" aria-hidden />
      <span className="text-micro font-bold uppercase tracking-wide text-muted-foreground">Sessions</span>
      <span className="text-micro text-mf-text-3">{count}</span>
      <div className="flex-1" />
      <ThreadListPrimitive.New asChild>
        <button data-testid="sessions-new-button" type="button" title="New session" className={iconBtn}>
          <PlusIcon className="size-[12px]" />
        </button>
      </ThreadListPrimitive.New>
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

export function SessionSidebar() {
  const threadListRuntime = useAssistantRuntime().threads;
  const allItems: SessionItem[] = threadListRuntime ? threadListStateToSessionItems(threadListRuntime.getState()) : [];
  const { filterProjectId, selectedTags, selectedSynthetic, sortMode, setFilterProjectId } = useSessionFilters();
  const isUnread = useUnreadStore((s) => s.isUnread);
  const unreadSet = useUnreadStore((s) => s.unread);
  const { projects, removeProjectFromList } = useProjects();
  const port = useDaemonPort();
  const registry = useTagRegistry(port);

  const filteredItems = useMemo(
    () => applySessionFilters(allItems, { filterProjectId, selectedTags, selectedSynthetic }),
    [allItems, filterProjectId, selectedTags, selectedSynthetic],
  );

  const groups = useMemo(() => arrangeSessions(filteredItems, sortMode), [filteredItems, sortMode]);

  const projectNameOf = useMemo(() => {
    const map = new Map(projects.map((p) => [p.id, p.name]));
    return (projectId: string): string => map.get(projectId) ?? projectId;
  }, [projects]);

  const attentionCounts = useMemo(
    () => buildAttentionMap(allItems, projects, isUnread),
    [allItems, projects, isUnread],
  );

  const footerCounts = useMemo(() => countByBaseStatus(allItems, unreadSet), [allItems, unreadSet]);

  const sortedProjects = useMemo(() => sortProjectsByRecentActivity(projects, allItems), [projects, allItems]);

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
        toast.success('Project removed', { description: project.name });
      } catch (error) {
        console.warn('[sessions] remove project failed', error);
        toast.error('Failed to remove project', {
          description: error instanceof Error ? error.message : String(error),
        });
      }
    },
    [filterProjectId, port, removeProjectFromList, setFilterProjectId],
  );

  // Project chip on each row only in "All" view (no active project filter); the
  // filter pill already narrows the list when a project is selected.
  const showProject = filterProjectId == null;
  const hasFilters = filterProjectId != null || selectedTags.size > 0 || selectedSynthetic.size > 0;

  return (
    <>
      <SessionsGroupHeader count={allItems.length} />

      <ProjectFilterPillBar
        projects={sortedProjects}
        filterProjectId={filterProjectId}
        attentionCounts={attentionCounts}
        onSelect={setFilterProjectId}
        onRemoveProject={(project) => void handleRemoveProject(project)}
      />

      <div
        className="mf-thin-scrollbar overscroll-contain min-h-0 flex-1 overflow-y-auto py-0.5"
        data-testid="sessions-list-scroll"
      >
        {filteredItems.length === 0 ? (
          <EmptyState hasFilters={hasFilters} />
        ) : (
          groups.map((group) => (
            <SessionGroup
              key={group.label}
              group={group}
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
          ))
        )}
      </div>

      <TagFilterBar items={allItems} filterProjectId={filterProjectId} registry={registry} />
      <SidebarFooter counts={footerCounts} />
    </>
  );
}
