/**
 * Projects REST wrapper — lists the daemon's known projects.
 */
import type { Project } from '@qlan-ro/mainframe-types';
import { apiBase, request } from './http';

export const getProjects = (port: number): Promise<Project[]> =>
  request<Project[]>('GET', `${apiBase(port)}/api/projects`);
