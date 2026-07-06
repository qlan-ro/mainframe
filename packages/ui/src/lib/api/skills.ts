/**
 * Skills REST wrapper — lists an adapter's skills for a given project path.
 */
import type { Skill } from '@qlan-ro/mainframe-types';
import { apiBase, request } from './http';

export const getSkills = (port: number, adapterId: string, projectPath: string): Promise<Skill[]> => {
  const qs = new URLSearchParams({ projectPath });
  return request<Skill[]>('GET', `${apiBase(port)}/api/adapters/${encodeURIComponent(adapterId)}/skills?${qs}`);
};
