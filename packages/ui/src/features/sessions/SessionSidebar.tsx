/**
 * The sidebar's Chats view — header, scope strip and the sessions list — fed
 * by the real daemon thread list. `layout/AppSidebar` owns the `Sidebar`
 * shell and the shared footer; this is the body it mounts for the rail's
 * Chats pick.
 *
 * Data flows exactly as it does in the shipped sidebar — subscribe to the stable
 * `threads.threadItems` array, project it once, then filter/group with the pure
 * view-models. Nothing here re-implements that logic; the clone is a visual
 * rebuild, so every non-visual module is imported from `@/features/sessions`.
 */
import { useMemo } from 'react';
import { useThreadItems } from '@/features/sessions/runtime/use-thread-items';
import { SYNTHETIC_TAGS } from '@qlan-ro/mainframe-types';
import { Plus, SearchIcon, SquarePen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Hint } from '@/components/ui/hint';
import {
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
} from '@/components/ui/sidebar';
import { chordHint } from '@/features/shortcuts/chord-hint';
import { emitSurfaceIntent } from '@/store/surface-intents';
import { useStartNewSession } from '@/features/sessions/new-thread/use-start-new-session';
import type { SessionItem } from '@/features/sessions/view-model/chat-to-thread-custom';
import { listedThreadItemsToSessionItems } from '@/features/sessions/view-model/task-chats';
import { arrangeSessions } from '@/features/sessions/view-model/group-sessions';
import { sortProjectsByRecentActivity } from '@/features/sessions/view-model/project-activity';
import { applySessionFilters } from '@/features/sessions/filter/apply-session-filters';
import { hasSynthetic, tagsInUse } from '@/features/sessions/filter/tags-in-use';
import { SessionLineageProvider, useSessionLineageValue } from '@/features/sessions/SessionLineageContext';
import { useProjects } from '@/features/sessions/use-projects';
import { useDaemonPort } from '@/features/sessions/runtime/daemon-port-context';
import { useDraftRow } from '@/features/sessions/sidebar/use-draft-row';
import { useTagRegistry } from '@/features/sessions/tags/use-tag-registry';
import { useSessionFilters } from '@/store/session-filters';
import { useStableList } from '@/lib/use-stable-list';
import { useToday } from '@/lib/use-today';
import { SidebarScrollRegion } from '../shared/SidebarScrollRegion';
import { HEADER_STACK_DEPTH } from './SessionGroupHeader';
import { SidebarScopeStrip } from './SidebarScopeStrip';
import { SessionsSection } from './SessionsSection';
import { FadeLabel } from '@/components/ui/fade-label';

/** The "New session" row under the header — ONE CLICK, always; the tour's primary anchor. */
export function NewSessionRow() {
  const newThread = useStartNewSession();
  return (
    <SidebarMenu className="mt-0.5">
      <SidebarMenuItem>
        <SidebarMenuButton
          className="gap-2.5 pr-1.5 text-body"
          data-testid="sidebar-action-new-thread"
          data-tut="new-session"
          onClick={newThread}
        >
          <SquarePen className="text-ink-secondary" />
          <FadeLabel className="flex-1">New session</FadeLabel>
          <Plus aria-hidden className="shrink-0 text-ink-secondary" />
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

export function SessionSidebar() {
  const threadItems = useThreadItems();

  // Project outside the selector — a fresh array inside it would loop useAuiState's Object.is.
  // Task chats have no row: each lives in its parent's `delegate_task` card.
  // A reload hands back the same SessionItems for unchanged chats, so the list
  // keeps its identity — and every memo below — when nothing visible moved.
  const allItems = useStableList(
    useMemo<SessionItem[]>(() => listedThreadItemsToSessionItems(threadItems), [threadItems]),
  );

  const { filterProjectIds, statusFilter, selectedTags, selectedSynthetic, sortMode } = useSessionFilters();

  const hasFilters =
    filterProjectIds.size > 0 || statusFilter !== 'all' || selectedTags.size > 0 || selectedSynthetic.size > 0;
  const registry = useTagRegistry(useDaemonPort());
  const { projects } = useProjects();

  const filteredItems = useMemo(
    () => applySessionFilters(allItems, { filterProjectIds, statusFilter, selectedTags, selectedSynthetic }),
    [allItems, filterProjectIds, statusFilter, selectedTags, selectedSynthetic],
  );

  const sortedProjects = useMemo(() => sortProjectsByRecentActivity(projects, allItems), [projects, allItems]);

  // Today's date, so the groups move on at midnight even when no session does.
  const today = useToday();
  const groups = useMemo(
    () => arrangeSessions(filteredItems, sortMode, today, sortedProjects),
    [filteredItems, sortMode, today, sortedProjects],
  );

  // Fork lineage (todo #343): shared with every row via context rather than
  // per-row prop drilling. `unfilteredIds` distinguishes a parent hidden by a
  // filter from one absent from the loaded set entirely (archived/deleted).
  const lineage = useSessionLineageValue(allItems, groups);

  const projectNames = useMemo(() => {
    const map: Record<string, string> = {};
    for (const project of sortedProjects) map[project.id] = project.name;
    return map;
  }, [sortedProjects]);

  const draft = useDraftRow(allItems, filterProjectIds);

  const tagNames = useMemo(() => tagsInUse(allItems, filterProjectIds), [allItems, filterProjectIds]);
  const syntheticTags = useMemo(() => SYNTHETIC_TAGS.filter((kind) => hasSynthetic(allItems, kind)), [allItems]);
  const searchChord = chordHint('app.search-palette');

  return (
    <>
      {/* The scope strip lives here, not in the scrolling body: shadcn
          documents the header as the home for a workspace switcher, and it is
          the one thing a long session list must not scroll away. */}
      <SidebarHeader className="gap-0 pt-0 pb-1">
        <div className="-mr-0.5 flex h-11 items-center justify-between pl-1">
          <span className="text-headline font-semibold">Chats</span>
          <span className="flex items-center text-muted-foreground">
            <Hint label={searchChord == null ? 'Search' : `Search (${searchChord})`}>
              <Button
                variant="ghost"
                size="icon"
                className="size-8 rounded-md"
                data-testid="sidebar-search"
                aria-label="Search"
                onClick={() => emitSurfaceIntent({ type: 'open-search-palette' })}
              >
                <SearchIcon />
              </Button>
            </Hint>
            <Hint label="Hide sidebar">
              <SidebarTrigger className="size-8 rounded-md" data-testid="sidebar-collapse" />
            </Hint>
          </span>
        </div>
        <NewSessionRow />
        <div className="mt-2">
          <SidebarScopeStrip />
        </div>
      </SidebarHeader>

      <SidebarScrollRegion tut="sessions-list" memoryKey="chats" scrollPaddingTop={HEADER_STACK_DEPTH}>
        <SessionLineageProvider value={lineage}>
          <SessionsSection
            groups={groups}
            projectNames={projectNames}
            draft={draft}
            hasFilters={hasFilters}
            tagNames={tagNames}
            syntheticTags={syntheticTags}
            registry={registry}
          />
        </SessionLineageProvider>
      </SidebarScrollRegion>
    </>
  );
}
