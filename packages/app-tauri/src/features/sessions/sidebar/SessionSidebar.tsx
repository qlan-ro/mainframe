/**
 * SessionSidebar — the full left panel shell.
 *
 * Composition:
 *   header (+ New) → ProjectFilterPillBar → TagFilterBar → scrollable grouped list
 *
 * Data:
 *   - useAssistantRuntime().threads for the native thread list (mapped via threadListStateToSessionItems)
 *   - useProjects() for the project set (filter pills + grouping)
 *   - useSessionFilters() for project/tag/synthetic filter state
 *   - useUnreadStore() for attention counts
 *   - useTagRegistry() for tag color resolution (TagFilterBar swatches)
 *   - groupSessions / applySessionFilters / attentionCount (pure VMs)
 */
import { useMemo } from 'react';
import { ThreadListPrimitive, useAssistantRuntime } from '@assistant-ui/react';
import { PlusIcon } from 'lucide-react';
import type { SessionItem } from '../view-model/chat-to-thread-custom';
import { threadListStateToSessionItems } from '../view-model/chat-to-thread-custom';
import { groupSessions } from '../view-model/group-sessions';
import { attentionCount } from '../view-model/attention-counts';
import { applySessionFilters } from '../filter/apply-session-filters';
import { useSessionFilters } from '@/store/session-filters';
import { useUnreadStore } from '@/store/unread-store';
import { useProjects } from '../use-projects';
import { SessionGroup } from './SessionGroup';
import { SessionRow } from './SessionRow';
import { ProjectFilterPillBar } from './ProjectFilterPillBar';
import { TagFilterBar } from '../filter/TagFilterBar';
import { useDaemonPort } from '../runtime/daemon-port-context';
import { useTagRegistry } from '../tags/use-tag-registry';

function EmptyState({ hasFilters }: { hasFilters: boolean }) {
  return (
    <div data-testid="sessions-empty-state" className="px-4 py-10 text-center text-caption text-muted-foreground">
      {hasFilters ? 'No sessions match these filters.' : 'No sessions yet'}
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
  const { filterProjectId, selectedTags, selectedSynthetic, setFilterProjectId } = useSessionFilters();
  const isUnread = useUnreadStore((s) => s.isUnread);
  const { projects } = useProjects();
  const port = useDaemonPort();
  const registry = useTagRegistry(port);

  const filteredItems = useMemo(
    () => applySessionFilters(allItems, { filterProjectId, selectedTags, selectedSynthetic }),
    [allItems, filterProjectId, selectedTags, selectedSynthetic],
  );

  const groups = useMemo(
    () => groupSessions(filteredItems, { filterProjectId, projects }),
    [filteredItems, filterProjectId, projects],
  );

  const attentionCounts = useMemo(
    () => buildAttentionMap(allItems, projects, isUnread),
    [allItems, projects, isUnread],
  );

  const hasFilters = filterProjectId != null || selectedTags.size > 0 || selectedSynthetic.size > 0;

  return (
    <div
      data-testid="sessions-sidebar"
      className="flex h-full w-full flex-col overflow-hidden bg-mf-glass font-sans text-foreground @container"
    >
      <div className="flex flex-shrink-0 items-center gap-1 border-b border-border/60 px-2.5 py-1.5">
        <span className="flex-1 text-micro font-bold uppercase tracking-widest text-muted-foreground">Sessions</span>
        <ThreadListPrimitive.New asChild>
          <button
            data-testid="sessions-new-button"
            type="button"
            title="New session"
            className="inline-flex size-[22px] items-center justify-center rounded-md text-mf-text-3 transition-colors hover:bg-accent hover:text-foreground"
          >
            <PlusIcon className="size-3" />
          </button>
        </ThreadListPrimitive.New>
      </div>

      <ProjectFilterPillBar
        projects={projects}
        filterProjectId={filterProjectId}
        attentionCounts={attentionCounts}
        onSelect={setFilterProjectId}
      />

      <TagFilterBar items={allItems} filterProjectId={filterProjectId} registry={registry} />

      <div className="min-h-0 flex-1 overflow-y-auto py-0.5">
        {filteredItems.length === 0 ? (
          <EmptyState hasFilters={hasFilters} />
        ) : (
          groups.map((group) => (
            <SessionGroup
              key={group.projectId}
              group={group}
              renderItem={(item) => <SessionRow key={item.id} item={item} colorOf={registry.colorOf} />}
            />
          ))
        )}
      </div>
    </div>
  );
}
