import type { PermissionRequest, SessionContext } from '@mainframe/types';
import { fetchJson, postJson, API_BASE } from './http';

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
  source: 'git' | 'session' = 'git',
  chatId?: string,
  oldPath?: string,
): Promise<{ original: string; modified: string; diff?: string; source: string }> {
  const params = new URLSearchParams({ file, source });
  if (chatId) params.set('chatId', chatId);
  if (oldPath) params.set('oldPath', oldPath);
  return fetchJson(`${API_BASE}/api/projects/${projectId}/diff?${params}`);
}

export async function getPendingPermission(chatId: string): Promise<PermissionRequest | null> {
  const json = await fetchJson<{ success: boolean; data: PermissionRequest | null }>(
    `${API_BASE}/api/chats/${chatId}/pending-permission`,
  );
  return json.data;
}

export async function getSessionChanges(chatId: string): Promise<{ files: string[] }> {
  return fetchJson(`${API_BASE}/api/chats/${chatId}/changes`);
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
