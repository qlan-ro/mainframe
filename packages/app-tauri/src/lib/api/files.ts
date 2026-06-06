/**
 * File search REST wrapper — searches files within a project.
 */
import { apiBase, request } from './http';

export interface FileResult {
  name: string;
  path: string;
  type: string;
  exact: boolean;
}

export const searchFiles = (port: number, projectId: string, query: string, chatId?: string): Promise<FileResult[]> => {
  const qs = new URLSearchParams({ q: query, limit: '30' });
  if (chatId) qs.set('chatId', chatId);
  return request<FileResult[]>(
    'GET',
    `${apiBase(port)}/api/projects/${encodeURIComponent(projectId)}/search/files?${qs}`,
  );
};
