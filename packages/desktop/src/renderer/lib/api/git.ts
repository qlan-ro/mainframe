import { postJson, API_BASE } from './http';
import type { ApiResponse } from '@qlan-ro/mainframe-types';

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
    const json = await postJson<ApiResponse<GitDiffResponse>>(
      `${API_BASE}/api/projects/${projectId}/git/diff-since-main`,
      { chatId, files },
    );
    if (!json.success) throw new Error(json.error);
    return json.data;
  },

  async getStatus(chatId: string): Promise<GitStatusResponse> {
    const json = await postJson<ApiResponse<GitStatusResponse>>(`${API_BASE}/api/git/status`, { chatId });
    if (!json.success) throw new Error(json.error);
    return json.data;
  },

  async stageFiles(chatId: string, files: string[]): Promise<void> {
    const json = await postJson<ApiResponse<never>>(`${API_BASE}/api/git/stage`, { chatId, files });
    if (!json.success) throw new Error(json.error);
  },

  async unstageFiles(chatId: string, files: string[]): Promise<void> {
    const json = await postJson<ApiResponse<never>>(`${API_BASE}/api/git/unstage`, { chatId, files });
    if (!json.success) throw new Error(json.error);
  },

  async commit(chatId: string, message: string, files: string[]): Promise<{ hash: string }> {
    const json = await postJson<ApiResponse<{ hash: string }>>(`${API_BASE}/api/git/commit`, {
      chatId,
      message,
      files,
    });
    if (!json.success) throw new Error(json.error);
    return json.data;
  },

  async push(chatId: string): Promise<void> {
    const json = await postJson<ApiResponse<never>>(`${API_BASE}/api/git/push`, { chatId });
    if (!json.success) throw new Error(json.error);
  },
};
