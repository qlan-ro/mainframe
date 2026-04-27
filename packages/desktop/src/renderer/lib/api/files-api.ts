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

/**
 * Reads a file at an absolute path that may live outside any project root.
 * Used by the editor when the user explicitly opens an external file.
 */
export async function getExternalFileContent(absolutePath: string): Promise<{ path: string; content: string }> {
  const params = new URLSearchParams({ path: absolutePath });
  return fetchJson(`${API_BASE}/api/files/external?${params}`);
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

export async function getPendingPermission(chatId: string): Promise<ControlRequest | null> {
  const json = await fetchJson<{ success: boolean; data: ControlRequest | null }>(
    `${API_BASE}/api/chats/${chatId}/pending-permission`,
  );
  return json.data;
}

export async function getSessionFiles(chatId: string): Promise<{ files: string[] }> {
  return fetchJson(`${API_BASE}/api/chats/${chatId}/session-files`);
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
  type?: 'file' | 'directory';
}

export async function browseFilesystem(
  dirPath?: string,
  opts?: { includeFiles?: boolean; includeHidden?: boolean },
): Promise<{ path: string; entries: BrowseEntry[] }> {
  const params = new URLSearchParams();
  if (dirPath) params.set('path', dirPath);
  if (opts?.includeFiles) params.set('includeFiles', 'true');
  if (opts?.includeHidden) params.set('includeHidden', 'true');
  const qs = params.toString();
  return fetchJson(`${API_BASE}/api/filesystem/browse${qs ? `?${qs}` : ''}`);
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
