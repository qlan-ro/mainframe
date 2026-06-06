/**
 * Groups SessionItems by projectId, sorts pinned-first then updatedAt desc.
 * When filterProjectId is set, returns a single flat group for that project.
 */
import type { Project } from '@qlan-ro/mainframe-types';
import type { SessionItem } from './chat-to-thread-custom';

export interface SessionGroup {
  projectId: string;
  projectName: string;
  count: number;
  items: SessionItem[];
}

export interface GroupSessionsOpts {
  filterProjectId: string | null;
  projects: Project[];
}

function resolveProjectName(projectId: string, projects: Project[]): string {
  return projects.find((p) => p.id === projectId)?.name ?? projectId;
}

function sortItems(items: SessionItem[]): SessionItem[] {
  return [...items].sort((a, b) => {
    const pinnedDiff = (b.custom.pinned ? 1 : 0) - (a.custom.pinned ? 1 : 0);
    if (pinnedDiff !== 0) return pinnedDiff;
    return b.custom.updatedAt - a.custom.updatedAt;
  });
}

function buildGroup(projectId: string, items: SessionItem[], projects: Project[]): SessionGroup {
  const sorted = sortItems(items);
  return {
    projectId,
    projectName: resolveProjectName(projectId, projects),
    count: sorted.length,
    items: sorted,
  };
}

export function groupSessions(items: SessionItem[], opts: GroupSessionsOpts): SessionGroup[] {
  const { filterProjectId, projects } = opts;

  if (filterProjectId !== null) {
    const filtered = items.filter((i) => i.custom.projectId === filterProjectId);
    return [buildGroup(filterProjectId, filtered, projects)];
  }

  const map = new Map<string, SessionItem[]>();
  for (const it of items) {
    const { projectId } = it.custom;
    let bucket = map.get(projectId);
    if (bucket === undefined) {
      bucket = [];
      map.set(projectId, bucket);
    }
    bucket.push(it);
  }

  return Array.from(map.entries()).map(([pid, bucket]) => buildGroup(pid, bucket, projects));
}
