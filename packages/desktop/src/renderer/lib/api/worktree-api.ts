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
  return postJson<{ chatId: string }>(`${API_BASE}/api/chats/${chatId}/fork-worktree`, { baseBranch, branchName });
}

export async function getWorktrees(
  projectId: string,
): Promise<{ worktrees: { path: string; branch: string | null }[] }> {
  return fetchJson(`${API_BASE}/api/projects/${projectId}/git/worktrees`);
}

export async function attachWorktree(chatId: string, worktreePath: string, branchName: string): Promise<void> {
  await postJson(`${API_BASE}/api/chats/${chatId}/attach-worktree`, { worktreePath, branchName });
}

export async function deleteWorktree(projectId: string, worktreePath: string, branchName?: string): Promise<void> {
  await postJson(`${API_BASE}/api/projects/${projectId}/git/delete-worktree`, { worktreePath, branchName });
}
