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

const MAX_SUGGESTIONS = 3;

/** First path segment, or a root sentinel for a repo-root file. */
function topArea(file: string): string {
  const idx = file.indexOf('/');
  return idx === -1 ? 'the project root' : file.slice(0, idx);
}

/**
 * One amber suggestion for the directory holding the most TODO/FIXME matches.
 * `matches` come from a bounded ripgrep pass in the route (already path-contained).
 */
export function buildTodoSuggestions(matches: { file: string }[]): Suggestion[] {
  if (matches.length === 0) return [];

  const counts = new Map<string, number>();
  for (const m of matches) {
    const area = topArea(m.file);
    counts.set(area, (counts.get(area) ?? 0) + 1);
  }

  let bestArea = '';
  let bestCount = 0;
  for (const [area, count] of counts) {
    if (count > bestCount) {
      bestArea = area;
      bestCount = count;
    }
  }

  return [
    {
      icon: 'list-checks',
      tint: 'amber',
      title: `Clean up the ${bestCount} TODO comments in ${bestArea}`,
      meta: `code · ${bestCount} matches`,
      prefill: `Find and address the TODO/FIXME comments in \`${bestArea}\`.`,
    },
  ];
}

/** Churn first, then todos, capped to at most 3. */
export function mergeSuggestions(churn: Suggestion[], todos: Suggestion[]): Suggestion[] {
  return [...churn, ...todos].slice(0, MAX_SUGGESTIONS);
}
