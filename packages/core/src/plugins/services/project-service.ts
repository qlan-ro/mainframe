import type { ProjectServiceAPI, ProjectSummary } from '@mainframe/types';
import type { DatabaseManager } from '../../db/index.js';

export function buildProjectService(db: DatabaseManager): ProjectServiceAPI {
  return {
    async listProjects(): Promise<ProjectSummary[]> {
      const projects = db.projects.list();
      return projects.map((p) => ({ id: p.id, name: p.name, path: p.path }));
    },

    async getProjectById(id: string): Promise<ProjectSummary | null> {
      const project = db.projects.get(id);
      if (!project) return null;
      return { id: project.id, name: project.name, path: project.path };
    },
  };
}
