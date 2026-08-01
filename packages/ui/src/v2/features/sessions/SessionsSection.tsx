/**
 * The sessions section: label, header actions, the new-session row, the draft
 * row, then the windowed list.
 *
 * The section collapses through the same ui-prefs entry the projects section
 * uses. Its header actions are `SidebarGroupAction`s — absolutely positioned
 * siblings of the label, not children of it — so collapsing the section still
 * leaves sort (and later, the overflow menu) reachable, the way a collapsed
 * Finder section keeps its header controls live.
 *
 * `min-h-0 flex-1` is threaded down every wrapper: the list is windowed and
 * measures the height it is given, so a wrapper that shrink-wraps its content
 * would collapse it to nothing.
 */
import { ChevronRightIcon } from 'lucide-react';
import type { Project, TagColor } from '@qlan-ro/mainframe-types';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@v2/components/ui/collapsible';
import { SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarMenu } from '@v2/components/ui/sidebar';
import type { SessionGroupResult } from '@/features/sessions/view-model/group-sessions';
import type { DraftRowState } from '@/features/sessions/sidebar/use-draft-row';
import { isSidebarSectionCollapsed, useUiPrefs } from '@/store/ui-prefs';
import { useSessionFilters } from '@/store/session-filters';
import { DraftSessionRow } from './DraftSessionRow';
import { SessionList } from './SessionList';
import { SessionSortMenu } from './SessionSortMenu';
import { SessionsMoreMenu } from './SessionsMoreMenu';
import { SessionsNewButton } from './SessionsNewButton';

interface SessionsSectionProps {
  groups: SessionGroupResult[];
  /** Project id → name, for the row hover cards and the draft row. */
  projectNames: Record<string, string>;
  colorOf?: (name: string) => TagColor;
  projects: Project[];
  /** Project id → session count, for the new-session picker. */
  sessionCounts: Record<string, number>;
  draft: DraftRowState;
  /** True when any filter narrows the list — changes the empty copy. */
  hasFilters: boolean;
}

export function SessionsSection({
  groups,
  projectNames,
  colorOf,
  projects,
  sessionCounts,
  draft,
  hasFilters,
}: SessionsSectionProps) {
  const { filterProjectId, sortMode, setSortMode } = useSessionFilters();
  const collapsedSections = useUiPrefs((s) => s.collapsedSidebarSections);
  const toggleSection = useUiPrefs((s) => s.toggleSidebarSection);
  const open = !isSidebarSectionCollapsed(collapsedSections, 'sessions');

  // "All" view is the only one where a row has to name its project; a filter
  // already answers the question for every row at once.
  const showProject = filterProjectId == null;

  return (
    <Collapsible
      open={open}
      onOpenChange={() => toggleSection('sessions')}
      className="group/sessions flex min-h-0 flex-1 flex-col"
    >
      <SidebarGroup className="min-h-0 flex-1 py-0">
        <SidebarGroupLabel asChild className="pl-2">
          <CollapsibleTrigger data-testid="sessions-section-toggle">
            <ChevronRightIcon className="transition-transform group-data-open/sessions:rotate-90" />
            Sessions
          </CollapsibleTrigger>
        </SidebarGroupLabel>
        {/* top-1.5 centres the action on the label of a py-0 group; the two
            sit on a 20px pitch, more outermost. */}
        <SessionSortMenu mode={sortMode} onChange={setSortMode} className="top-1.5 right-8" />
        <SessionsMoreMenu className="top-1.5 right-3" />

        <CollapsibleContent className="flex min-h-0 flex-1 flex-col">
          <SidebarGroupContent className="flex min-h-0 flex-1 flex-col">
            <SidebarMenu>
              <SessionsNewButton
                filterProjectId={filterProjectId}
                filterProjectName={filterProjectId != null ? (projectNames[filterProjectId] ?? null) : null}
                projects={projects}
                sessionCounts={sessionCounts}
              />
              {draft.visible && draft.model != null && (
                <DraftSessionRow
                  projectId={draft.model.projectId}
                  projectName={projectNames[draft.model.projectId] ?? draft.model.projectId}
                  selected={draft.selected}
                  showProject={showProject}
                  onSelect={draft.onSelect}
                  onDiscard={draft.onDiscard}
                />
              )}
            </SidebarMenu>

            <SessionList groups={groups} projectNames={projectNames} colorOf={colorOf} hasFilters={hasFilters} />
          </SidebarGroupContent>
        </CollapsibleContent>
      </SidebarGroup>
    </Collapsible>
  );
}
