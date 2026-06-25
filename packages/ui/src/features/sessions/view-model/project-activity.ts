import type { Project } from '@qlan-ro/mainframe-types';
import type { SessionItem } from './chat-to-thread-custom';

export function sortProjectsByRecentActivity(projects: Project[], items: SessionItem[]): Project[] {
  const latestByProject = new Map<string, number>();
  for (const item of items) {
    const previous = latestByProject.get(item.custom.projectId) ?? 0;
    if (item.custom.updatedAt > previous) {
      latestByProject.set(item.custom.projectId, item.custom.updatedAt);
    }
  }

  const originalIndex = new Map(projects.map((project, index) => [project.id, index]));
  return [...projects].sort((a, b) => {
    const delta = (latestByProject.get(b.id) ?? 0) - (latestByProject.get(a.id) ?? 0);
    if (delta !== 0) return delta;
    return (originalIndex.get(a.id) ?? 0) - (originalIndex.get(b.id) ?? 0);
  });
}
