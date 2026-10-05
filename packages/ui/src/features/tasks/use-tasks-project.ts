/**
 * useTasksProject — the ONE project Tasks shows (D7): the session scope's
 * sole project. Null when the scope is empty or names more than one project
 * — the sidebar list and the body then show a pick list instead, and
 * picking narrows the shared scope (`soloFilterProject`) rather than
 * recording a local override. Shared by `TasksSidebarList` and
 * `TasksSurface` so the two can never disagree about which project Tasks is
 * showing.
 */
import { soleProjectId, useSessionFilters } from '@/store/session-filters';

export function useTasksProject(): string | null {
  return useSessionFilters((s) => soleProjectId(s.filterProjectIds));
}
