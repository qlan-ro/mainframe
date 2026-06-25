/**
 * Git REST wrappers for the daemon API.
 *
 * Read-only helpers (getGitStatus, getWorkingDiff) are preserved from the
 * original file. Branch/worktree write operations are added here for B1.
 *
 * All routes are under `/api/projects/:projectId/git/` and wrapped in the
 * `ApiResponse<T>` envelope — use `request<T>` for typed responses and
 * `requestEmpty` for routes that return `okEmpty` (no data field).
 */
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
import { apiBase, request, requestEmpty } from './http';

/** `{ path, branch }` shape returned by the `/worktrees` route. */
export interface WorktreeEntry {
  path: string;
  branch: string | null;
}

export interface GitStatusFile {
  /** Repo-relative path. */
  path: string;
  /** Porcelain status code (e.g. 'M', 'A', 'D', '??', 'R'). */
  status: string;
}

interface GitStatusResponse {
  files: GitStatusFile[];
  error?: string;
}

/** Working-tree changes for a project (empty list when not a git repo). */
export async function getGitStatus(port: number, projectId: string, chatId?: string): Promise<GitStatusFile[]> {
  const qs = new URLSearchParams();
  if (chatId) qs.set('chatId', chatId);
  const suffix = qs.toString() ? `?${qs}` : '';
  const data = await request<GitStatusResponse>(
    'GET',
    `${apiBase(port)}/api/projects/${encodeURIComponent(projectId)}/git/status${suffix}`,
  );
  return data.files ?? [];
}

export interface WorkingDiff {
  diff: string;
  original: string;
  modified: string;
  source: string;
}

/**
 * Working-tree diff for a single file. Returns the daemon's data as-is;
 * a soft-error (untracked/clean file) yields empty strings with success:true.
 */
export async function getWorkingDiff(
  port: number,
  projectId: string,
  file: string,
  opts?: { base?: string; chatId?: string },
): Promise<WorkingDiff> {
  const qs = new URLSearchParams();
  qs.set('file', file);
  qs.set('source', 'git');
  if (opts?.base) qs.set('base', opts.base);
  if (opts?.chatId) qs.set('chatId', opts.chatId);
  return request<WorkingDiff>('GET', `${apiBase(port)}/api/projects/${encodeURIComponent(projectId)}/git/diff?${qs}`);
}

// ---------------------------------------------------------------------------
// Branch helpers
// ---------------------------------------------------------------------------

function projGit(port: number, projectId: string): string {
  return `${apiBase(port)}/api/projects/${encodeURIComponent(projectId)}/git`;
}

function chatQs(chatId?: string): string {
  return chatId ? `?chatId=${encodeURIComponent(chatId)}` : '';
}

export const getGitBranch = (port: number, projectId: string, chatId?: string): Promise<{ branch: string | null }> =>
  request('GET', `${projGit(port, projectId)}/branch${chatQs(chatId)}`);

export const getGitBranches = (port: number, projectId: string, chatId?: string): Promise<BranchListResult> =>
  request('GET', `${projGit(port, projectId)}/branches${chatQs(chatId)}`);

export const gitCheckout = (port: number, projectId: string, branch: string, chatId?: string): Promise<void> =>
  requestEmpty('POST', `${projGit(port, projectId)}/checkout`, { branch, ...(chatId ? { chatId } : {}) });

export const gitCreateBranch = (
  port: number,
  projectId: string,
  name: string,
  startPoint?: string,
  chatId?: string,
): Promise<void> =>
  requestEmpty('POST', `${projGit(port, projectId)}/branch`, {
    name,
    ...(startPoint ? { startPoint } : {}),
    ...(chatId ? { chatId } : {}),
  });

export const gitFetch = (port: number, projectId: string, remote?: string, chatId?: string): Promise<FetchResult> =>
  request('POST', `${projGit(port, projectId)}/fetch`, {
    ...(remote ? { remote } : {}),
    ...(chatId ? { chatId } : {}),
  });

export const gitPull = (
  port: number,
  projectId: string,
  opts: { remote?: string; branch?: string; localBranch?: string; chatId?: string } = {},
): Promise<PullResult> => request('POST', `${projGit(port, projectId)}/pull`, { ...opts });

export const gitPush = (
  port: number,
  projectId: string,
  opts: { branch?: string; remote?: string; chatId?: string } = {},
): Promise<PushResult> => request('POST', `${projGit(port, projectId)}/push`, { ...opts });

export const gitMerge = (port: number, projectId: string, branch: string, chatId?: string): Promise<MergeResult> =>
  request('POST', `${projGit(port, projectId)}/merge`, { branch, ...(chatId ? { chatId } : {}) });

export const gitRebase = (port: number, projectId: string, branch: string, chatId?: string): Promise<RebaseResult> =>
  request('POST', `${projGit(port, projectId)}/rebase`, { branch, ...(chatId ? { chatId } : {}) });

// NOTE: the abort route returns ok(res, data) but the shape is only {aborted:boolean}.
// We consume it as empty — the popover never reads the field.
// Do NOT "fix" to request<{aborted:boolean}> and assert on a field nothing uses.
export const gitAbort = (port: number, projectId: string, chatId?: string): Promise<void> =>
  requestEmpty('POST', `${projGit(port, projectId)}/abort`, chatId ? { chatId } : {});

export const gitRenameBranch = (
  port: number,
  projectId: string,
  oldName: string,
  newName: string,
  chatId?: string,
): Promise<void> =>
  requestEmpty('POST', `${projGit(port, projectId)}/rename-branch`, {
    oldName,
    newName,
    ...(chatId ? { chatId } : {}),
  });

export const gitDeleteBranch = (
  port: number,
  projectId: string,
  name: string,
  opts: { force?: boolean; remote?: boolean; chatId?: string } = {},
): Promise<DeleteBranchResult> => request('POST', `${projGit(port, projectId)}/delete-branch`, { name, ...opts });

export const gitUpdateAll = (port: number, projectId: string, chatId?: string): Promise<UpdateAllResult> =>
  request('POST', `${projGit(port, projectId)}/update-all`, chatId ? { chatId } : {});

// ---------------------------------------------------------------------------
// Worktree helpers
// ---------------------------------------------------------------------------

export const getProjectWorktrees = async (port: number, projectId: string): Promise<WorktreeEntry[]> =>
  (await request<{ worktrees: WorktreeEntry[] }>('GET', `${projGit(port, projectId)}/worktrees`)).worktrees;

export const deleteWorktree = (
  port: number,
  projectId: string,
  worktreePath: string,
  branchName?: string,
): Promise<void> =>
  requestEmpty('POST', `${projGit(port, projectId)}/delete-worktree`, {
    worktreePath,
    ...(branchName ? { branchName } : {}),
  });

/** Isolate the active session into a new worktree on `branchName` forked from `baseBranch`. */
export const enableWorktree = (port: number, chatId: string, baseBranch: string, branchName: string): Promise<void> =>
  requestEmpty('POST', `${apiBase(port)}/api/chats/${encodeURIComponent(chatId)}/enable-worktree`, {
    baseBranch,
    branchName,
  });

/** Attach the active session to an existing worktree at `worktreePath` on `branchName`. */
export const attachWorktree = (port: number, chatId: string, worktreePath: string, branchName: string): Promise<void> =>
  requestEmpty('POST', `${apiBase(port)}/api/chats/${encodeURIComponent(chatId)}/attach-worktree`, {
    worktreePath,
    branchName,
  });

// ---------------------------------------------------------------------------
// Branch diffs (Changes tab — "Branch" mode)
// ---------------------------------------------------------------------------

/** Files differing between the active branch and its base branch. */
export interface BranchDiffResponse {
  branch: string | null;
  baseBranch: string | null;
  mergeBase: string | null;
  files: { path: string; status: string; oldPath?: string }[];
}

export const getBranchDiffs = (port: number, projectId: string, chatId?: string): Promise<BranchDiffResponse> =>
  request('GET', `${projGit(port, projectId)}/branch-diffs${chatQs(chatId)}`);
