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
import { useAuiState } from '@assistant-ui/react';
import { SYNTHETIC_TAGS } from '@qlan-ro/mainframe-types';
import { PenLine, SearchIcon } from 'lucide-react';
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
import { regularThreadItemsToSessionItems } from '@/features/sessions/view-model/chat-to-thread-custom';
import { arrangeSessions } from '@/features/sessions/view-model/group-sessions';
import { sortProjectsByRecentActivity } from '@/features/sessions/view-model/project-activity';
import { applySessionFilters } from '@/features/sessions/filter/apply-session-filters';
import { hasSynthetic, tagsInUse } from '@/features/sessions/filter/tags-in-use';
import { SessionLineageProvider } from '@/features/sessions/SessionLineageContext';
import { useProjects } from '@/features/sessions/use-projects';
import { useAddProject } from '@/features/sessions/use-add-project';
import { useDaemonPort } from '@/features/sessions/runtime/daemon-port-context';
import { useDraftRow } from '@/features/sessions/sidebar/use-draft-row';
import { useTagRegistry } from '@/features/sessions/tags/use-tag-registry';
import { useSessionFilters } from '@/store/session-filters';
import { SidebarScrollRegion } from '../shared/SidebarScrollRegion';
import { ScopeStrip } from './ScopeStrip';
import { SessionsSection } from './SessionsSection';
import { useRemoveProject } from '@/features/sessions/use-remove-project';

/** The "New session" row under the header — ONE CLICK, always; the tour's primary anchor. */
function NewSessionRow() {
  const newThread = useStartNewSession();
  const chord = chordHint('sessions.new');
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        {/* `pl-1`: the pen lines up with "Chats" and the scope avatars (all 12px
            in); the hover fill still starts on the rows' 8px edge. */}
        <SidebarMenuButton
          className="pl-1"
          data-testid="sidebar-action-new-thread"
          data-tut="new-session"
          onClick={newThread}
        >
          <PenLine />
          <span className="min-w-0 flex-1 truncate">New session</span>
          {chord != null && <span className="shrink-0 font-mono text-xs text-muted-foreground">{chord}</span>}
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

export function SessionSidebar() {
  const threadItems = useAuiState((s) => s.threads.threadItems);

  // Project outside the selector — a fresh array inside it would loop useAuiState's Object.is.
  const allItems = useMemo<SessionItem[]>(() => regularThreadItemsToSessionItems(threadItems), [threadItems]);

  const { filterProjectIds, selectedTags, selectedSynthetic, sortMode, toggleFilterProject, soloFilterProject } =
    useSessionFilters();

  const hasFilters = filterProjectIds.size > 0 || selectedTags.size > 0 || selectedSynthetic.size > 0;
  const registry = useTagRegistry(useDaemonPort());
  const { projects, removeProjectFromList, reloadProjects } = useProjects();
  const onRemoveProject = useRemoveProject(removeProjectFromList);
  const onAddProject = useAddProject(reloadProjects);

  const filteredItems = useMemo(
    () => applySessionFilters(allItems, { filterProjectIds, selectedTags, selectedSynthetic }),
    [allItems, filterProjectIds, selectedTags, selectedSynthetic],
  );

  const sortedProjects = useMemo(() => sortProjectsByRecentActivity(projects, allItems), [projects, allItems]);

  const groups = useMemo(
    () => arrangeSessions(filteredItems, sortMode, Date.now(), sortedProjects),
    [filteredItems, sortMode, sortedProjects],
  );

  // Fork lineage (todo #343): shared with every row via context rather than
  // per-row prop drilling. `unfilteredIds` distinguishes a parent hidden by a
  // filter from one absent from the loaded set entirely (archived/deleted).
  const unfilteredIds = useMemo(() => new Set(allItems.map((i) => i.id)), [allItems]);
  const listedIds = useMemo(() => new Set(groups.flatMap((g) => g.items.map((i) => i.id))), [groups]);
  const lineage = useMemo(() => ({ allItems, listedIds, unfilteredIds }), [allItems, listedIds, unfilteredIds]);

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
      <SidebarHeader className="gap-3">
        {/* The title bar owns the traffic lights and the app chrome now; this
            52px row is the view's own name, search and its collapse. */}
        <div className="flex h-9 items-center justify-between pl-1">
          <span className="text-base font-semibold">Chats</span>
          <span className="flex items-center text-muted-foreground">
            <Hint label={searchChord == null ? 'Search' : `Search (${searchChord})`}>
              <Button
                variant="ghost"
                size="icon-sm"
                data-testid="sidebar-search"
                aria-label="Search"
                onClick={() => emitSurfaceIntent({ type: 'open-search-palette' })}
              >
                <SearchIcon />
              </Button>
            </Hint>
            <Hint label="Hide sidebar">
              <SidebarTrigger data-testid="sidebar-collapse" />
            </Hint>
          </span>
        </div>
        <NewSessionRow />
        <ScopeStrip
          projects={sortedProjects}
          scope={filterProjectIds}
          onToggle={toggleFilterProject}
          onSolo={soloFilterProject}
          onRemoveProject={onRemoveProject}
          onAddProject={() => void onAddProject()}
        />
      </SidebarHeader>

      <SidebarScrollRegion tut="sessions-list">
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
