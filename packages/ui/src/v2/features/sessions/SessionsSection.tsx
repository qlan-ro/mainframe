/**
 * The sessions list, mounted straight into the sidebar.
 *
 * There is no "Sessions" section wrapping it: the group-by groups (Pinned /
 * Today / … , or one per project) ARE the sections, so the panel is one level
 * shallower. The first group's header is parked at the top of the scroll region
 * rather than drawn in the list — it carries New / sort / more, and those have
 * to stay reachable from the bottom of a long list, the same way Tasks and Tags
 * stay reachable from the top.
 */
import type { Project, TagColor } from '@qlan-ro/mainframe-types';
import { SidebarMenu } from '@v2/components/ui/sidebar';
import { SidebarJumpSection } from '../shared/SidebarJumpSection';
import type { SessionGroupResult } from '@/features/sessions/view-model/group-sessions';
import type { DraftRowState } from '@/features/sessions/sidebar/use-draft-row';
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

  // "All" view is the only one where a row has to name its project; a filter
  // already answers the question for every row at once.
  const showProject = filterProjectId == null;

  const actions = (
    <>
      <SessionsNewButton
        filterProjectId={filterProjectId}
        filterProjectName={filterProjectId != null ? (projectNames[filterProjectId] ?? null) : null}
        projects={projects}
        sessionCounts={sessionCounts}
      />
      <SessionSortMenu mode={sortMode} onChange={setSortMode} />
      <SessionsMoreMenu />
    </>
  );

  return (
    <SidebarJumpSection
      label={groups[0]?.label ?? 'Sessions'}
      testId="sessions-section"
      sticky="top-0"
      actions={actions}
    >
      <>
        {draft.visible && draft.model != null && (
          <SidebarMenu>
            <DraftSessionRow
              projectId={draft.model.projectId}
              projectName={projectNames[draft.model.projectId] ?? draft.model.projectId}
              selected={draft.selected}
              showProject={showProject}
              onSelect={draft.onSelect}
              onDiscard={draft.onDiscard}
            />
          </SidebarMenu>
        )}

        <SessionList groups={groups} projectNames={projectNames} colorOf={colorOf} hasFilters={hasFilters} />
      </>
    </SidebarJumpSection>
  );
}
