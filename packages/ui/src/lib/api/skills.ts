/**
 * Skills REST wrappers — list an adapter's skills for a project path, and
 * delete one by id.
 */
import type { Skill } from '@qlan-ro/mainframe-types';
import { apiBase, request, requestEmpty } from './http';

export const getSkills = (port: number, adapterId: string, projectPath: string): Promise<Skill[]> => {
  const qs = new URLSearchParams({ projectPath });
  return request<Skill[]>('GET', `${apiBase(port)}/api/adapters/${encodeURIComponent(adapterId)}/skills?${qs}`);
};

/**
 * Skill ids carry `:` separators (`claude:<scope>:<name>`), so the id is
 * percent-encoded into the path. `projectPath` goes in the query rather than a
 * body — the daemon accepts either, and query keeps the request bodyless.
 */
export const deleteSkill = (port: number, adapterId: string, skillId: string, projectPath: string): Promise<void> => {
  const qs = new URLSearchParams({ projectPath });
  return requestEmpty(
    'DELETE',
    `${apiBase(port)}/api/adapters/${encodeURIComponent(adapterId)}/skills/${encodeURIComponent(skillId)}?${qs}`,
  );
};
