/**
 * File search, project tree, and filesystem browse REST wrappers.
 */
import { apiBase, request } from './http';

export interface FileResult {
  name: string;
  path: string;
  type: string;
  exact: boolean;
}

export interface FileTreeEntry {
  name: string;
  type: 'file' | 'directory';
  path: string;
}

export const searchFiles = (port: number, projectId: string, query: string, chatId?: string): Promise<FileResult[]> => {
  const qs = new URLSearchParams({ q: query, limit: '30' });
  if (chatId) qs.set('chatId', chatId);
  return request<FileResult[]>(
    'GET',
    `${apiBase(port)}/api/projects/${encodeURIComponent(projectId)}/search/files?${qs}`,
  );
};

export const getFileTree = (port: number, projectId: string, dir = '.', chatId?: string): Promise<FileTreeEntry[]> => {
  const qs = new URLSearchParams({ path: dir });
  if (chatId) qs.set('chatId', chatId);
  return request<FileTreeEntry[]>('GET', `${apiBase(port)}/api/projects/${encodeURIComponent(projectId)}/tree?${qs}`);
};

interface FileContentResponse {
  path: string;
  content: string;
}

/**
 * Read a project file's UTF-8 content via the daemon (worktree-aware). Accepts
 * a repo-relative path (file tree) OR an absolute path under the project
 * (chat tool-cards) — the daemon resolves both against the worktree base.
 */
export async function getProjectFile(port: number, projectId: string, path: string, chatId?: string): Promise<string> {
  const qs = new URLSearchParams({ path });
  if (chatId) qs.set('chatId', chatId);
  const data = await request<FileContentResponse>(
    'GET',
    `${apiBase(port)}/api/projects/${encodeURIComponent(projectId)}/files?${qs}`,
  );
  return data.content;
}

/**
 * Read a project file's content as a base64 string via the daemon
 * (worktree-aware). Same path resolution as `getProjectFile` but appends
 * `encoding=base64` — suitable for binary files (images, PDFs).
 */
export async function getProjectFileBase64(
  port: number,
  projectId: string,
  path: string,
  chatId?: string,
): Promise<string> {
  const qs = new URLSearchParams({ path, encoding: 'base64' });
  if (chatId) qs.set('chatId', chatId);
  const data = await request<FileContentResponse>(
    'GET',
    `${apiBase(port)}/api/projects/${encodeURIComponent(projectId)}/files?${qs}`,
  );
  return data.content;
}

interface BrowseOpts {
  includeFiles?: boolean;
  includeHidden?: boolean;
}

/** The daemon wraps browse as `{success:true, data:{path, entries:[…]}}`. */
interface BrowseResponseData {
  path: string;
  entries: FileTreeEntry[];
}

export async function browseFilesystem(port: number, dir: string, opts: BrowseOpts = {}): Promise<FileTreeEntry[]> {
  const qs = new URLSearchParams({ path: dir });
  if (opts.includeFiles !== undefined) qs.set('includeFiles', String(opts.includeFiles));
  if (opts.includeHidden !== undefined) qs.set('includeHidden', String(opts.includeHidden));
  const data = await request<BrowseResponseData>('GET', `${apiBase(port)}/api/filesystem/browse?${qs}`);
  return data.entries;
}
