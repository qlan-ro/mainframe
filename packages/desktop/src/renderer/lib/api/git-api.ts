import type {
  BranchListResult,
  FetchResult,
  PullResult,
  PushResult,
  MergeResult,
  RebaseResult,
  DeleteBranchResult,
  UpdateAllResult,
  ApiResponse,
} from '@qlan-ro/mainframe-types';
import { fetchJson, postJson, API_BASE } from './http';

export async function getGitBranch(projectId: string, chatId?: string): Promise<{ branch: string | null }> {
  const params = chatId ? `?chatId=${chatId}` : '';
  const json = await fetchJson<ApiResponse<{ branch: string | null }>>(
    `${API_BASE}/api/projects/${projectId}/git/branch${params}`,
  );
  if (!json.success) throw new Error(json.error);
  return json.data;
}

export async function getGitStatus(
  projectId: string,
  chatId?: string,
): Promise<{ files: { status: string; path: string }[] }> {
  const params = chatId ? `?chatId=${chatId}` : '';
  const json = await fetchJson<ApiResponse<{ files: { status: string; path: string }[] }>>(
    `${API_BASE}/api/projects/${projectId}/git/status${params}`,
  );
  if (!json.success) throw new Error(json.error);
  return json.data;
}

export async function getGitBranches(projectId: string, chatId?: string): Promise<BranchListResult> {
  const params = chatId ? `?chatId=${chatId}` : '';
  const json = await fetchJson<ApiResponse<BranchListResult>>(
    `${API_BASE}/api/projects/${projectId}/git/branches${params}`,
  );
  if (!json.success) throw new Error(json.error);
  return json.data;
}

export async function gitCheckout(projectId: string, branch: string, chatId?: string): Promise<void> {
  const json = await postJson<ApiResponse<unknown>>(`${API_BASE}/api/projects/${projectId}/git/checkout`, {
    branch,
    chatId,
  });
  if (!json.success) throw new Error(json.error);
}

export async function gitCreateBranch(
  projectId: string,
  name: string,
  startPoint?: string,
  chatId?: string,
): Promise<void> {
  const json = await postJson<ApiResponse<unknown>>(`${API_BASE}/api/projects/${projectId}/git/branch`, {
    name,
    startPoint,
    chatId,
  });
  if (!json.success) throw new Error(json.error);
}

export async function gitFetch(projectId: string, remote?: string, chatId?: string): Promise<FetchResult> {
  const json = await postJson<ApiResponse<FetchResult>>(`${API_BASE}/api/projects/${projectId}/git/fetch`, {
    remote,
    chatId,
  });
  if (!json.success) throw new Error(json.error);
  return json.data;
}

export async function gitPull(
  projectId: string,
  remote?: string,
  branch?: string,
  localBranch?: string,
  chatId?: string,
): Promise<PullResult> {
  const json = await postJson<ApiResponse<PullResult>>(`${API_BASE}/api/projects/${projectId}/git/pull`, {
    remote,
    branch,
    localBranch,
    chatId,
  });
  if (!json.success) throw new Error(json.error);
  return json.data;
}

export async function gitPush(
  projectId: string,
  branch?: string,
  remote?: string,
  chatId?: string,
): Promise<PushResult> {
  const json = await postJson<ApiResponse<PushResult>>(`${API_BASE}/api/projects/${projectId}/git/push`, {
    branch,
    remote,
    chatId,
  });
  if (!json.success) throw new Error(json.error);
  return json.data;
}

export async function gitMerge(projectId: string, branch: string, chatId?: string): Promise<MergeResult> {
  const json = await postJson<ApiResponse<MergeResult>>(`${API_BASE}/api/projects/${projectId}/git/merge`, {
    branch,
    chatId,
  });
  if (!json.success) throw new Error(json.error);
  return json.data;
}

export async function gitRebase(projectId: string, branch: string, chatId?: string): Promise<RebaseResult> {
  const json = await postJson<ApiResponse<RebaseResult>>(`${API_BASE}/api/projects/${projectId}/git/rebase`, {
    branch,
    chatId,
  });
  if (!json.success) throw new Error(json.error);
  return json.data;
}

export async function gitAbort(projectId: string, chatId?: string): Promise<{ aborted: boolean }> {
  const json = await postJson<ApiResponse<{ aborted: boolean }>>(`${API_BASE}/api/projects/${projectId}/git/abort`, {
    chatId,
  });
  if (!json.success) throw new Error(json.error);
  return json.data;
}

export async function gitRenameBranch(
  projectId: string,
  oldName: string,
  newName: string,
  chatId?: string,
): Promise<void> {
  const json = await postJson<ApiResponse<unknown>>(`${API_BASE}/api/projects/${projectId}/git/rename-branch`, {
    oldName,
    newName,
    chatId,
  });
  if (!json.success) throw new Error(json.error);
}

export async function gitDeleteBranch(
  projectId: string,
  name: string,
  force?: boolean,
  remote?: boolean,
  chatId?: string,
): Promise<DeleteBranchResult> {
  const json = await postJson<ApiResponse<DeleteBranchResult>>(
    `${API_BASE}/api/projects/${projectId}/git/delete-branch`,
    { name, force, remote, chatId },
  );
  if (!json.success) throw new Error(json.error);
  return json.data;
}

export async function gitUpdateAll(projectId: string, chatId?: string): Promise<UpdateAllResult> {
  const json = await postJson<ApiResponse<UpdateAllResult>>(`${API_BASE}/api/projects/${projectId}/git/update-all`, {
    chatId,
  });
  if (!json.success) throw new Error(json.error);
  return json.data;
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
  const json = await fetchJson<ApiResponse<{ original: string; modified: string; diff?: string; source: string }>>(
    `${API_BASE}/api/projects/${projectId}/git/diff?${params}`,
  );
  if (!json.success) throw new Error(json.error);
  return json.data;
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
  const json = await fetchJson<ApiResponse<BranchDiffResponse>>(
    `${API_BASE}/api/projects/${projectId}/git/branch-diffs${qs ? `?${qs}` : ''}`,
  );
  if (!json.success) throw new Error(json.error);
  return json.data;
}
