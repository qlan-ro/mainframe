/**
 * Pure visibility rule for the synthetic draft row in the sidebar. The draft is
 * shown once its project is resolved (a draft-config exists), and it respects the
 * project filter pill: hidden when a DIFFERENT project's pill is active.
 */
export interface DraftRowModel {
  newThreadId: string;
  projectId: string;
}

export function draftRowVisible(model: DraftRowModel | null, filterProjectId: string | null): boolean {
  if (model == null) return false;
  if (filterProjectId == null) return true;
  return filterProjectId === model.projectId;
}
