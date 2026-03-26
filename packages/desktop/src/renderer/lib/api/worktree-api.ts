import { API_BASE, postJson } from './http';

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
