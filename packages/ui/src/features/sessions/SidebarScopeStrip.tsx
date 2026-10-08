/**
 * SidebarScopeStrip — the project scope strip wired once, so Chats, Tasks,
 * Automations and the Setup Advisor all render the IDENTICAL control (same
 * store, same handlers) in the same header position (D7). Settings has no
 * project scope and does not mount this. Projects are ordered most recently
 * used first, by their latest session activity.
 */
import { useMemo } from 'react';
import { useAuiState } from '@assistant-ui/react';
import { useSessionFilters } from '@/store/session-filters';
import { regularThreadItemsToSessionItems } from './view-model/chat-to-thread-custom';
import { sortProjectsByRecentActivity } from './view-model/project-activity';
import { useProjects } from './use-projects';
import { useAddProject } from './use-add-project';
import { useRemoveProject } from './use-remove-project';
import { ScopeStrip } from './ScopeStrip';

export function SidebarScopeStrip() {
  const filterProjectIds = useSessionFilters((s) => s.filterProjectIds);
  const toggleFilterProject = useSessionFilters((s) => s.toggleFilterProject);
  const soloFilterProject = useSessionFilters((s) => s.soloFilterProject);
  const { projects, removeProjectFromList, reloadProjects } = useProjects();
  const onRemoveProject = useRemoveProject(removeProjectFromList);
  const onAddProject = useAddProject(reloadProjects);
  const threadItems = useAuiState((s) => s.threads.threadItems);
  // Project outside the selector — a fresh array inside it would loop useAuiState's Object.is.
  const recentProjects = useMemo(
    () => sortProjectsByRecentActivity(projects, regularThreadItemsToSessionItems(threadItems)),
    [projects, threadItems],
  );

  return (
    <ScopeStrip
      projects={recentProjects}
      scope={filterProjectIds}
      onToggle={toggleFilterProject}
      onSolo={soloFilterProject}
      onRemoveProject={onRemoveProject}
      onAddProject={() => void onAddProject()}
    />
  );
}
