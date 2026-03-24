import type { ControlRequest, SessionContext, SearchContentResult } from '@qlan-ro/mainframe-types';
import { fetchJson, postJson, putJson, API_BASE } from './http';

export async function getFileTree(
  projectId: string,
  dirPath = '.',
  chatId?: string,
): Promise<{ name: string; type: 'file' | 'directory'; path: string }[]> {
  const params = new URLSearchParams({ path: dirPath });
  if (chatId) params.set('chatId', chatId);
  return fetchJson(`${API_BASE}/api/projects/${projectId}/tree?${params}`);
}

export async function getFilesList(projectId: string, chatId?: string): Promise<string[]> {
  const params = chatId ? `?chatId=${chatId}` : '';
  return fetchJson(`${API_BASE}/api/projects/${projectId}/files-list${params}`);
}

export async function searchFiles(
  projectId: string,
  query: string,
  limit = 50,
  chatId?: string,
): Promise<{ name: string; path: string; type: string }[]> {
  const params = new URLSearchParams({ q: query, limit: String(limit) });
  if (chatId) params.set('chatId', chatId);
  return fetchJson(`${API_BASE}/api/projects/${projectId}/search/files?${params}`);
}

export async function getFileContent(
  projectId: string,
  filePath: string,
  chatId?: string,
): Promise<{ path: string; content: string }> {
  const params = new URLSearchParams({ path: filePath });
  if (chatId) params.set('chatId', chatId);
  return fetchJson(`${API_BASE}/api/projects/${projectId}/files?${params}`);
}

export async function saveFileContent(
  projectId: string,
  filePath: string,
  content: string,
  chatId?: string,
): Promise<void> {
  await putJson(`${API_BASE}/api/projects/${projectId}/files`, { path: filePath, content, chatId });
}

export async function getFileBinary(
  projectId: string,
  filePath: string,
  chatId?: string,
): Promise<{ path: string; content: string; encoding: 'base64' }> {
  const params = new URLSearchParams({ path: filePath, encoding: 'base64' });
  if (chatId) params.set('chatId', chatId);
  return fetchJson(`${API_BASE}/api/projects/${projectId}/files?${params}`);
}

export async function getGitStatus(
  projectId: string,
  chatId?: string,
): Promise<{ files: { status: string; path: string }[] }> {
  const params = chatId ? `?chatId=${chatId}` : '';
  return fetchJson(`${API_BASE}/api/projects/${projectId}/git/status${params}`);
}

export async function getGitBranch(projectId: string, chatId?: string): Promise<{ branch: string | null }> {
  const params = chatId ? `?chatId=${chatId}` : '';
  return fetchJson(`${API_BASE}/api/projects/${projectId}/git/branch${params}`);
}

export async function getDiff(
  projectId: string,
  file: string,
  source: 'git' = 'git',
  chatId?: string,
  oldPath?: string,
  base?: string,
): Promise<{ original: string; modified: string; diff?: string; source: string }> {
  const params = new URLSearchParams({ file, source });
  if (chatId) params.set('chatId', chatId);
  if (oldPath) params.set('oldPath', oldPath);
  if (base) params.set('base', base);
  return fetchJson(`${API_BASE}/api/projects/${projectId}/git/diff?${params}`);
}

export async function getPendingPermission(chatId: string): Promise<ControlRequest | null> {
  const json = await fetchJson<{ success: boolean; data: ControlRequest | null }>(
    `${API_BASE}/api/chats/${chatId}/pending-permission`,
  );
  return json.data;
}

export interface SessionFileDiff {
  filePath: string;
  original: string | null;
  modified: string;
  status: 'added' | 'modified';
}

export async function getSessionDiffs(chatId: string): Promise<{ files: SessionFileDiff[] }> {
  return fetchJson(`${API_BASE}/api/chats/${chatId}/session-diffs`);
}

export interface BranchDiffResponse {
  branch: string | null;
  baseBranch: string | null;
  mergeBase: string | null;
  files: { path: string; status: string; oldPath?: string }[];
}

export async function getBranchDiffs(projectId: string, chatId?: string): Promise<BranchDiffResponse> {
  const params = new URLSearchParams();
  if (chatId) params.set('chatId', chatId);
  const qs = params.toString();
  return fetchJson(`${API_BASE}/api/projects/${projectId}/git/branch-diffs${qs ? `?${qs}` : ''}`);
}

export async function getSessionContext(chatId: string): Promise<SessionContext> {
  const json = await fetchJson<{ success: boolean; data: SessionContext }>(`${API_BASE}/api/chats/${chatId}/context`);
  return json.data;
}

export async function getSessionFile(chatId: string, filePath: string): Promise<{ path: string; content: string }> {
  return fetchJson(`${API_BASE}/api/chats/${chatId}/session-file?path=${encodeURIComponent(filePath)}`);
}

export async function addMention(
  chatId: string,
  mention: { kind: string; name: string; path?: string },
): Promise<void> {
  await postJson(`${API_BASE}/api/chats/${chatId}/mentions`, mention);
}

export interface BrowseEntry {
  name: string;
  path: string;
}

export async function browseFilesystem(dirPath?: string): Promise<{ path: string; entries: BrowseEntry[] }> {
  const params = dirPath ? `?path=${encodeURIComponent(dirPath)}` : '';
  return fetchJson(`${API_BASE}/api/filesystem/browse${params}`);
}

export async function searchContent(
  projectId: string,
  query: string,
  scopePath: string,
  includeIgnored?: boolean,
  chatId?: string,
  signal?: AbortSignal,
): Promise<SearchContentResult[]> {
  const params = new URLSearchParams({ q: query, path: scopePath });
  if (includeIgnored) params.set('includeIgnored', 'true');
  if (chatId) params.set('chatId', chatId);
  const res = await fetch(`${API_BASE}/api/projects/${projectId}/search/content?${params}`, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  return json.results;
}
