import { describe, it, expect } from 'vitest';
import { buildChurnSuggestions } from '../../server/suggestions/build-suggestions.js';

describe('buildChurnSuggestions', () => {
  it('emits a working-changes suggestion (accent) when the tree is dirty', () => {
    const out = buildChurnSuggestions({
      branch: 'main',
      baseBranch: 'main',
      workingFileCount: 3,
      branchDiffCount: 0,
    });
    expect(out).toEqual([
      {
        icon: 'git-compare',
        tint: 'accent',
        title: 'Review the working changes',
        meta: 'git · 3 files uncommitted',
        prefill:
          'Review the uncommitted changes in the working tree, summarize what they do, and flag anything unsafe to commit.',
      },
    ]);
  });

  it('emits a branch-churn suggestion when the branch diverges from its base', () => {
    const out = buildChurnSuggestions({
      branch: 'feat/x',
      baseBranch: 'main',
      workingFileCount: 0,
      branchDiffCount: 5,
    });
    expect(out).toEqual([
      {
        icon: 'git-branch',
        tint: 'accent',
        title: 'Summarize what changed on feat/x',
        meta: 'git · 5 files vs main',
        prefill: 'Summarize the changes on the `feat/x` branch compared to `main`.',
      },
    ]);
  });

  it('emits working-changes first, then branch churn, when both apply', () => {
    const out = buildChurnSuggestions({
      branch: 'feat/x',
      baseBranch: 'main',
      workingFileCount: 2,
      branchDiffCount: 4,
    });
    expect(out.map((s) => s.title)).toEqual(['Review the working changes', 'Summarize what changed on feat/x']);
  });

  it('returns [] on a clean repo with no divergence', () => {
    expect(
      buildChurnSuggestions({ branch: 'main', baseBranch: 'main', workingFileCount: 0, branchDiffCount: 0 }),
    ).toEqual([]);
  });

  it('does not emit branch churn when there is no base branch', () => {
    expect(
      buildChurnSuggestions({ branch: 'feat/x', baseBranch: null, workingFileCount: 0, branchDiffCount: 3 }),
    ).toEqual([]);
  });
});
