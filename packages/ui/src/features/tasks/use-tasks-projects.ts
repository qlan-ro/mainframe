/**
 * useTasksProjects — the project SET Tasks shows (multi-project, same scope
 * semantics as Chats/Automations, D7-multi): the session scope's projects,
 * union; an empty scope means every known project. Ids come back in
 * scope-strip order (the `useProjects` list order, which is what
 * `ScopeStrip`/`SidebarScopeStrip` render in) and are filtered to projects
 * the scope still knows about — a project removed mid-session silently drops
 * out rather than leaving a dangling id.
 *
 * Replaces the single-project `useTasksProject` (D7-sole): there is no more
 * "pick a project" fallback — a multi/empty scope is a normal state Tasks
 * renders directly, merging every project's bucket (see `useMergedTodos`).
 * Shared by `TasksSidebarList` and `TasksSurface`/`TasksBoard` so they never
 * disagree about which projects Tasks is showing.
 */
import { useMemo } from 'react';
import { useSessionFilters } from '@/store/session-filters';
import { useProjects } from '@/features/sessions/use-projects';

export function useTasksProjects(): string[] {
  const scope = useSessionFilters((s) => s.filterProjectIds);
  const { projects } = useProjects();
  return useMemo(() => {
    const inScope = scope.size === 0 ? projects : projects.filter((p) => scope.has(p.id));
    return inScope.map((p) => p.id);
  }, [scope, projects]);
}
