/**
 * SidebarScopeStrip — the project scope strip wired once, so Chats, Tasks,
 * Automations and the Setup Advisor all render the IDENTICAL control (same
 * store, same handlers) in the same header position (D7). Settings has no
 * project scope and does not mount this.
 */
import { useSessionFilters } from '@/store/session-filters';
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

  return (
    <ScopeStrip
      projects={projects}
      scope={filterProjectIds}
      onToggle={toggleFilterProject}
      onSolo={soloFilterProject}
      onRemoveProject={onRemoveProject}
      onAddProject={() => void onAddProject()}
    />
  );
}
