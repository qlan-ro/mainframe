/**
 * The sessions list, mounted straight into the sidebar.
 *
 * There is no "Sessions" section wrapping it: the group-by groups (Pinned /
 * Today / … , or one per project) ARE the sections, so the panel is one level
 * shallower. The first group's header is parked at the top of the scroll region
 * rather than drawn in the list — it carries filter / sort / more, and those have
 * to stay reachable from the bottom of a long list, the same way Tasks and Tags
 * stay reachable from the top.
 */
import type { SYNTHETIC_TAGS } from '@qlan-ro/mainframe-types';
import { SidebarMenu } from '@/components/ui/sidebar';
import type { TagRegistry } from '@/features/sessions/tags/use-tag-registry';
import { SidebarJumpSection } from '../shared/SidebarJumpSection';
import type { SessionGroupResult } from '@/features/sessions/view-model/group-sessions';
import type { DraftRowState } from '@/features/sessions/sidebar/use-draft-row';
import { soleProjectId, useSessionFilters } from '@/store/session-filters';
import { DraftSessionRow } from './DraftSessionRow';
import { SessionList } from './SessionList';
import { SessionSortMenu } from './SessionSortMenu';
import { SessionsMoreMenu } from './SessionsMoreMenu';
import { SessionsFilterMenu } from './SessionsFilterMenu';

interface SessionsSectionProps {
  groups: SessionGroupResult[];
  /** Project id → name, for the row hover cards and the draft row. */
  projectNames: Record<string, string>;
  draft: DraftRowState;
  /** True when any filter narrows the list — changes the empty copy. */
  hasFilters: boolean;
  /** Tag names in use / synthetic kinds present — what the filter menu offers. */
  tagNames: string[];
  syntheticTags: (typeof SYNTHETIC_TAGS)[number][];
  registry: TagRegistry;
}

export function SessionsSection({
  groups,
  projectNames,
  draft,
  hasFilters,
  tagNames,
  syntheticTags,
  registry,
}: SessionsSectionProps) {
  const { filterProjectIds, sortMode, setSortMode } = useSessionFilters();
  const soleProject = soleProjectId(filterProjectIds);

  // A single-project scope is the only view where every row shares one project;
  // "All" and a multi-project scope both need the rows to name theirs.
  const showProject = soleProject == null;

  // The first group header's 20px controls: filter (with its active chip), sort, more.
  const actions = (
    <>
      <SessionsFilterMenu inUse={tagNames} synthetic={syntheticTags} registry={registry} />
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
              projectName={
                draft.model.projectId != null
                  ? (projectNames[draft.model.projectId] ?? draft.model.projectId)
                  : 'No project'
              }
              selected={draft.selected}
              showProject={showProject}
              onSelect={draft.onSelect}
              onDiscard={draft.onDiscard}
            />
          </SidebarMenu>
        )}

        <SessionList groups={groups} projectNames={projectNames} colorOf={registry.colorOf} hasFilters={hasFilters} />
      </>
    </SidebarJumpSection>
  );
}
