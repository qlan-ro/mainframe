import { describe, expect, it } from 'vitest';
import { deriveSummaryRows, type SummaryInput } from '../summary-view';

const input = (over: Partial<SummaryInput> = {}): SummaryInput => ({
  branch: { name: null, isWorktree: false },
  context: { percent: null },
  prs: [],
  changes: null,
  ...over,
});

describe('deriveSummaryRows', () => {
  it('emits nothing when the session has no data yet', () => {
    expect(deriveSummaryRows(input())).toEqual([]);
  });

  it('emits the rows in Branch · Context · PR · Changes order', () => {
    const rows = deriveSummaryRows(
      input({
        branch: { name: 'main', isWorktree: false },
        context: { percent: 42 },
        prs: [{ url: 'https://github.com/a/b/pull/7', owner: 'a', repo: 'b', number: 7, source: 'created' }],
        changes: { fileCount: 3, additions: 12, deletions: 4 },
      }),
    );
    expect(rows.map((r) => r.kind)).toEqual(['branch', 'context', 'pr', 'changes']);
  });
});

describe('deriveSummaryRows — branch', () => {
  it('carries the branch name and no worktree marker on a plain checkout', () => {
    const [row] = deriveSummaryRows(input({ branch: { name: 'main', isWorktree: false } }));
    expect(row).toEqual({
      kind: 'branch',
      label: 'Branch',
      value: 'main',
      tooltip: 'main',
      isWorktree: false,
    });
  });

  it('marks a worktree session', () => {
    const [row] = deriveSummaryRows(input({ branch: { name: 'design/panel', isWorktree: true } }));
    expect(row).toEqual({
      kind: 'branch',
      label: 'Branch',
      value: 'design/panel',
      tooltip: 'design/panel · worktree',
      isWorktree: true,
    });
  });

  it('omits the row when the branch is unknown', () => {
    expect(deriveSummaryRows(input({ branch: { name: null, isWorktree: true } }))).toEqual([]);
    expect(deriveSummaryRows(input({ branch: { name: '', isWorktree: false } }))).toEqual([]);
  });
});

describe('deriveSummaryRows — context', () => {
  it('renders the percentage with a token tooltip when both counts are known', () => {
    const [row] = deriveSummaryRows(input({ context: { percent: 42, usedTokens: 84_400, maxTokens: 200_000 } }));
    expect(row).toEqual({
      kind: 'context',
      label: 'Context',
      value: '42%',
      tooltip: '84.4k / 200k tokens',
      percent: 42,
    });
  });

  it('falls back to a generic tooltip when the token counts are unknown', () => {
    const [row] = deriveSummaryRows(input({ context: { percent: 7 } }));
    expect(row).toMatchObject({ value: '7%', tooltip: 'Context usage' });
  });

  it('omits the row when the percentage cannot be derived', () => {
    expect(deriveSummaryRows(input({ context: { percent: null, usedTokens: 10, maxTokens: 100 } }))).toEqual([]);
  });

  it('keeps a zero percentage — 0% is a reading, not a missing value', () => {
    const [row] = deriveSummaryRows(input({ context: { percent: 0 } }));
    expect(row).toMatchObject({ kind: 'context', value: '0%' });
  });
});

describe('deriveSummaryRows — PRs', () => {
  it('emits one row per detected PR, labelled by number and sourced by word', () => {
    const rows = deriveSummaryRows(
      input({
        prs: [
          { url: 'https://github.com/a/b/pull/7', owner: 'a', repo: 'b', number: 7, source: 'created' },
          { url: 'https://github.com/a/b/pull/9', owner: 'a', repo: 'b', number: 9, source: 'mentioned' },
        ],
      }),
    );
    expect(rows).toEqual([
      {
        kind: 'pr',
        label: 'PR #7',
        value: 'created',
        tooltip: 'https://github.com/a/b/pull/7',
        number: 7,
        url: 'https://github.com/a/b/pull/7',
      },
      {
        kind: 'pr',
        label: 'PR #9',
        value: 'mentioned',
        tooltip: 'https://github.com/a/b/pull/9',
        number: 9,
        url: 'https://github.com/a/b/pull/9',
      },
    ]);
  });
});

describe('deriveSummaryRows — changes', () => {
  it('carries the file count and the +/− totals', () => {
    const [row] = deriveSummaryRows(input({ changes: { fileCount: 3, additions: 12, deletions: 4 } }));
    expect(row).toEqual({
      kind: 'changes',
      label: 'Changes',
      value: '3 files',
      tooltip: 'Open the review panel',
      fileCount: 3,
      additions: 12,
      deletions: 4,
    });
  });

  it('says "1 file" in the singular', () => {
    const [row] = deriveSummaryRows(input({ changes: { fileCount: 1, additions: 1, deletions: 0 } }));
    expect(row).toMatchObject({ value: '1 file' });
  });

  it('renders a clean tree rather than hiding the row', () => {
    const [row] = deriveSummaryRows(input({ changes: { fileCount: 0, additions: 0, deletions: 0 } }));
    expect(row).toMatchObject({ kind: 'changes', value: 'No changes', fileCount: 0 });
  });

  it('passes absent counts through as undefined, never as zero', () => {
    const [row] = deriveSummaryRows(input({ changes: { fileCount: 2 } }));
    expect(row).toEqual({
      kind: 'changes',
      label: 'Changes',
      value: '2 files',
      tooltip: 'Open the review panel',
      fileCount: 2,
      additions: undefined,
      deletions: undefined,
    });
  });

  it('omits the row while the change data has not loaded', () => {
    expect(deriveSummaryRows(input({ changes: null }))).toEqual([]);
  });
});
