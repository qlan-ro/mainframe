/**
 * Agents REST wrapper — lists an adapter's agents for a given project path.
 */
import type { AgentConfig } from '@qlan-ro/mainframe-types';
import { apiBase, request } from './http';

export const getAgents = (port: number, adapterId: string, projectPath: string): Promise<AgentConfig[]> => {
  const qs = new URLSearchParams({ projectPath });
  return request<AgentConfig[]>('GET', `${apiBase(port)}/api/adapters/${encodeURIComponent(adapterId)}/agents?${qs}`);
};
