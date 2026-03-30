export interface BranchInfo {
  name: string;
  current: boolean;
  tracking?: string;
  worktree?: string;
}

export interface BranchListResult {
  current: string;
  local: BranchInfo[];
  remote: string[];
  worktrees: string[];
}

export type FetchResult = {
  status: 'success';
  remote: string;
};

export type PullResult =
  | { status: 'success'; summary: { changes: number; insertions: number; deletions: number } }
  | { status: 'up-to-date' }
  | { status: 'conflict'; conflicts: string[]; message: string };

export type MergeResult =
  | { status: 'success'; summary: { commits: number; insertions: number; deletions: number } }
  | { status: 'conflict'; conflicts: string[]; message: string };

export type RebaseResult = { status: 'success' } | { status: 'conflict'; conflicts: string[]; message: string };

export type PushResult =
  | { status: 'success'; branch: string; remote: string }
  | { status: 'rejected'; message: string };

export type DeleteBranchResult = { status: 'success' } | { status: 'not-merged'; message: string };

export interface BranchUpdateStatus {
  branch: string;
  status: 'updated' | 'up-to-date' | 'error';
  error?: string;
}

export interface UpdateAllResult {
  fetched: boolean;
  pull: PullResult;
  branches: BranchUpdateStatus[];
}
