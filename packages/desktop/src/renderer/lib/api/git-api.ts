import type {
  BranchListResult,
  FetchResult,
  PullResult,
  PushResult,
  MergeResult,
  RebaseResult,
  DeleteBranchResult,
  UpdateAllResult,
} from '@qlan-ro/mainframe-types';
import { fetchJson, postJson, API_BASE } from './http';

export async function getGitBranch(projectId: string, chatId?: string): Promise<{ branch: string | null }> {
  const params = chatId ? `?chatId=${chatId}` : '';
  return fetchJson(`${API_BASE}/api/projects/${projectId}/git/branch${params}`);
}

export async function getGitStatus(
  projectId: string,
  chatId?: string,
): Promise<{ files: { status: string; path: string }[] }> {
  const params = chatId ? `?chatId=${chatId}` : '';
  return fetchJson(`${API_BASE}/api/projects/${projectId}/git/status${params}`);
}

export async function getGitBranches(projectId: string, chatId?: string): Promise<BranchListResult> {
  const params = chatId ? `?chatId=${chatId}` : '';
  return fetchJson(`${API_BASE}/api/projects/${projectId}/git/branches${params}`);
}

export async function gitCheckout(projectId: string, branch: string, chatId?: string): Promise<void> {
  await postJson(`${API_BASE}/api/projects/${projectId}/git/checkout`, { branch, chatId });
}

export async function gitCreateBranch(
  projectId: string,
  name: string,
  startPoint?: string,
  chatId?: string,
): Promise<void> {
  await postJson(`${API_BASE}/api/projects/${projectId}/git/branch`, { name, startPoint, chatId });
}

export async function gitFetch(projectId: string, remote?: string, chatId?: string): Promise<FetchResult> {
  return postJson(`${API_BASE}/api/projects/${projectId}/git/fetch`, { remote, chatId });
}

export async function gitPull(
  projectId: string,
  remote?: string,
  branch?: string,
  localBranch?: string,
  chatId?: string,
): Promise<PullResult> {
  return postJson(`${API_BASE}/api/projects/${projectId}/git/pull`, { remote, branch, localBranch, chatId });
}

export async function gitPush(
  projectId: string,
  branch?: string,
  remote?: string,
  chatId?: string,
): Promise<PushResult> {
  return postJson(`${API_BASE}/api/projects/${projectId}/git/push`, { branch, remote, chatId });
}

export async function gitMerge(projectId: string, branch: string, chatId?: string): Promise<MergeResult> {
  return postJson(`${API_BASE}/api/projects/${projectId}/git/merge`, { branch, chatId });
}

export async function gitRebase(projectId: string, branch: string, chatId?: string): Promise<RebaseResult> {
  return postJson(`${API_BASE}/api/projects/${projectId}/git/rebase`, { branch, chatId });
}

export async function gitAbort(projectId: string, chatId?: string): Promise<{ aborted: boolean }> {
  return postJson(`${API_BASE}/api/projects/${projectId}/git/abort`, { chatId });
}

export async function gitRenameBranch(
  projectId: string,
  oldName: string,
  newName: string,
  chatId?: string,
): Promise<void> {
  await postJson(`${API_BASE}/api/projects/${projectId}/git/rename-branch`, { oldName, newName, chatId });
}

export async function gitDeleteBranch(
  projectId: string,
  name: string,
  force?: boolean,
  remote?: boolean,
  chatId?: string,
): Promise<DeleteBranchResult> {
  return postJson(`${API_BASE}/api/projects/${projectId}/git/delete-branch`, { name, force, remote, chatId });
}

export async function gitUpdateAll(projectId: string, chatId?: string): Promise<UpdateAllResult> {
  return postJson(`${API_BASE}/api/projects/${projectId}/git/update-all`, { chatId });
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

export async function getUncommittedFiles(
  projectId: string,
  chatId?: string,
): Promise<{ files: { path: string; status: string }[] }> {
  const params = new URLSearchParams();
  if (chatId) params.set('chatId', chatId);
  const qs = params.toString();
  return fetchJson(`${API_BASE}/api/projects/${projectId}/git/status${qs ? `?${qs}` : ''}`);
}
