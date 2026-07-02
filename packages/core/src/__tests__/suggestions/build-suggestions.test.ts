import { describe, it, expect } from 'vitest';
import {
  buildChurnSuggestions,
  buildTodoSuggestions,
  mergeSuggestions,
} from '../../server/suggestions/build-suggestions.js';

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

  it('singularizes "file" in the working-changes meta when there is exactly 1', () => {
    const out = buildChurnSuggestions({
      branch: 'main',
      baseBranch: 'main',
      workingFileCount: 1,
      branchDiffCount: 0,
    });
    expect(out[0]?.meta).toBe('git · 1 file uncommitted');
  });

  it('singularizes "file" in the branch-churn meta when there is exactly 1', () => {
    const out = buildChurnSuggestions({
      branch: 'feat/x',
      baseBranch: 'main',
      workingFileCount: 0,
      branchDiffCount: 1,
    });
    expect(out[0]?.meta).toBe('git · 1 file vs main');
  });
});

describe('buildTodoSuggestions', () => {
  it('groups matches by top-level dir and reports the largest area (amber)', () => {
    const out = buildTodoSuggestions([
      { file: 'src/a.ts' },
      { file: 'src/b.ts' },
      { file: 'src/c.ts' },
      { file: 'docs/x.md' },
    ]);
    expect(out).toEqual([
      {
        icon: 'list-checks',
        tint: 'amber',
        title: 'Clean up the 3 TODO comments in src',
        meta: 'code · 3 matches',
        prefill: 'Find and address the TODO/FIXME comments in `src`.',
      },
    ]);
  });

  it('uses a root-file bucket label when a match is at the repo root', () => {
    const out = buildTodoSuggestions([{ file: 'README.md' }]);
    expect(out[0]?.title).toBe('Clean up the 1 TODO comments in the project root');
  });

  it('returns [] for no matches', () => {
    expect(buildTodoSuggestions([])).toEqual([]);
  });
});

describe('mergeSuggestions', () => {
  it('keeps churn first, then todos, capped at 3', () => {
    const churn = [
      { icon: 'a', tint: 'accent', title: 'c1', meta: '', prefill: 'p' },
      { icon: 'b', tint: 'accent', title: 'c2', meta: '', prefill: 'p' },
    ] as const;
    const todos = [
      { icon: 'c', tint: 'amber', title: 't1', meta: '', prefill: 'p' },
      { icon: 'd', tint: 'amber', title: 't2', meta: '', prefill: 'p' },
    ] as const;
    expect(mergeSuggestions([...churn], [...todos]).map((s) => s.title)).toEqual(['c1', 'c2', 't1']);
  });
});
