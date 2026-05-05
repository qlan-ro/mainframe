import { postJson, API_BASE } from './http';

export interface GitDiffResponse {
  diffs: Record<string, { main: string; worktree: string }>;
  baseBranch?: string | null;
  mergeBase?: string | null;
}

export interface GitStatusResponse {
  staged: string[];
  unstaged: string[];
  untracked: string[];
}

export const gitApi = {
  async getDiff(projectId: string, chatId: string, files?: string[]): Promise<GitDiffResponse> {
    return postJson(`${API_BASE}/api/projects/${projectId}/git/diff-since-main`, { chatId, files });
  },

  async getStatus(chatId: string): Promise<GitStatusResponse> {
    return postJson(`${API_BASE}/api/git/status`, { chatId });
  },

  async stageFiles(chatId: string, files: string[]): Promise<{ success: boolean }> {
    return postJson(`${API_BASE}/api/git/stage`, { chatId, files });
  },

  async unstageFiles(chatId: string, files: string[]): Promise<{ success: boolean }> {
    // No dedicated backend endpoint yet — placeholder for future /api/git/unstage route.
    return postJson(`${API_BASE}/api/git/unstage`, { chatId, files });
  },

  async commit(chatId: string, message: string, files: string[]): Promise<{ hash: string }> {
    return postJson(`${API_BASE}/api/git/commit`, { chatId, message, files });
  },

  async push(chatId: string): Promise<{ success: boolean }> {
    return postJson(`${API_BASE}/api/git/push`, { chatId });
  },
};
