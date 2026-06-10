/**
 * Projects REST wrapper — lists the daemon's known projects.
 */
import type { Project } from '@qlan-ro/mainframe-types';
import { apiBase, request, requestNoContent } from './http';

export const getProjects = (port: number): Promise<Project[]> =>
  request<Project[]>('GET', `${apiBase(port)}/api/projects`);

export const removeProject = (port: number, projectId: string): Promise<void> =>
  requestNoContent('DELETE', `${apiBase(port)}/api/projects/${encodeURIComponent(projectId)}`);
