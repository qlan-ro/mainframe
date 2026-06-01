import type { ApiResponse } from '@qlan-ro/mainframe-types';
import { API_BASE, fetchJson, postJson } from './http';

export async function enableWorktree(chatId: string, baseBranch: string, branchName: string): Promise<void> {
  await postJson(`${API_BASE}/api/chats/${chatId}/enable-worktree`, { baseBranch, branchName });
}

export async function disableWorktree(chatId: string): Promise<void> {
  await postJson(`${API_BASE}/api/chats/${chatId}/disable-worktree`);
}

export async function forkToWorktree(
  chatId: string,
  baseBranch: string,
  branchName: string,
): Promise<{ chatId: string }> {
  const json = await postJson<ApiResponse<{ chatId: string }>>(`${API_BASE}/api/chats/${chatId}/fork-worktree`, {
    baseBranch,
    branchName,
  });
  if (!json.success) throw new Error(json.error);
  return json.data;
}

export async function getWorktrees(
  projectId: string,
): Promise<{ worktrees: { path: string; branch: string | null }[] }> {
  const json = await fetchJson<ApiResponse<{ worktrees: { path: string; branch: string | null }[] }>>(
    `${API_BASE}/api/projects/${projectId}/git/worktrees`,
  );
  if (!json.success) throw new Error(json.error);
  return json.data;
}

export async function attachWorktree(chatId: string, worktreePath: string, branchName: string): Promise<void> {
  await postJson(`${API_BASE}/api/chats/${chatId}/attach-worktree`, { worktreePath, branchName });
}

export async function deleteWorktree(projectId: string, worktreePath: string, branchName?: string): Promise<void> {
  await postJson(`${API_BASE}/api/projects/${projectId}/git/delete-worktree`, { worktreePath, branchName });
}
