/**
 * Git REST wrappers (read-only). The daemon serves git status/diff per project;
 * the Inspector's Changes tab consumes status.
 */
import { apiBase, request } from './http';

export interface GitStatusFile {
  /** Repo-relative path. */
  path: string;
  /** Porcelain status code (e.g. 'M', 'A', 'D', '??', 'R'). */
  status: string;
}

interface GitStatusResponse {
  files: GitStatusFile[];
  error?: string;
}

/** Working-tree changes for a project (empty list when not a git repo). */
export async function getGitStatus(port: number, projectId: string, chatId?: string): Promise<GitStatusFile[]> {
  const qs = new URLSearchParams();
  if (chatId) qs.set('chatId', chatId);
  const suffix = qs.toString() ? `?${qs}` : '';
  const data = await request<GitStatusResponse>(
    'GET',
    `${apiBase(port)}/api/projects/${encodeURIComponent(projectId)}/git/status${suffix}`,
  );
  return data.files ?? [];
}
