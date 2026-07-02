import type { Suggestion } from '@qlan-ro/mainframe-types';

export interface ChurnInput {
  branch: string | null;
  baseBranch: string | null;
  workingFileCount: number;
  branchDiffCount: number;
}

/**
 * Derive up-to-two "churn" suggestions from cheap git signals: the dirty working
 * tree (accent) and, when the branch diverges from its detected base, a branch
 * summary (accent). Pure — the route gathers the counts via GitService.
 */
export function buildChurnSuggestions(input: ChurnInput): Suggestion[] {
  const out: Suggestion[] = [];

  if (input.workingFileCount > 0) {
    out.push({
      icon: 'git-compare',
      tint: 'accent',
      title: 'Review the working changes',
      meta: `git · ${input.workingFileCount} files uncommitted`,
      prefill:
        'Review the uncommitted changes in the working tree, summarize what they do, and flag anything unsafe to commit.',
    });
  }

  if (
    input.branch != null &&
    input.baseBranch != null &&
    input.branch !== input.baseBranch &&
    input.branchDiffCount > 0
  ) {
    out.push({
      icon: 'git-branch',
      tint: 'accent',
      title: `Summarize what changed on ${input.branch}`,
      meta: `git · ${input.branchDiffCount} files vs ${input.baseBranch}`,
      prefill: `Summarize the changes on the \`${input.branch}\` branch compared to \`${input.baseBranch}\`.`,
    });
  }

  return out;
}
