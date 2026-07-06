import { describe, it, expect } from 'vitest';
import { gitStatusToFiles } from '../git-status-to-files';

describe('gitStatusToFiles', () => {
  it('maps a variety of real XY porcelain codes to semantic statuses (counts default to 0)', () => {
    const input = [
      { path: 'a.ts', status: 'A' },
      { path: 'b.ts', status: 'M' },
      { path: 'c.ts', status: 'D' },
      { path: 'd.ts', status: 'R' },
      { path: 'e.ts', status: 'MM' },
      { path: 'f.ts', status: 'RM' },
      { path: 'g.ts', status: '??' },
    ];
    expect(gitStatusToFiles(input as never)).toEqual([
      { path: 'a.ts', status: 'added', additions: 0, deletions: 0 },
      { path: 'b.ts', status: 'modified', additions: 0, deletions: 0 },
      { path: 'c.ts', status: 'deleted', additions: 0, deletions: 0 },
      { path: 'd.ts', status: 'renamed', additions: 0, deletions: 0 },
      { path: 'e.ts', status: 'modified', additions: 0, deletions: 0 },
      { path: 'f.ts', status: 'renamed', additions: 0, deletions: 0 },
      { path: 'g.ts', status: 'added', additions: 0, deletions: 0 },
    ]);
  });

  it('merges per-file additions/deletions from the working stat by path', () => {
    const input = [
      { path: 'a.ts', status: 'M' },
      { path: 'b.ts', status: 'A' },
    ];
    const stat = {
      files: [
        { path: 'a.ts', additions: 5, deletions: 2 },
        { path: 'b.ts', additions: 10, deletions: 0 },
      ],
      totalAdditions: 15,
      totalDeletions: 2,
    };
    expect(gitStatusToFiles(input as never, stat)).toEqual([
      { path: 'a.ts', status: 'modified', additions: 5, deletions: 2 },
      { path: 'b.ts', status: 'added', additions: 10, deletions: 0 },
    ]);
  });

  it('falls back to 0 counts for files missing from the stat', () => {
    const input = [{ path: 'a.ts', status: 'M' }];
    const stat = { files: [{ path: 'other.ts', additions: 3, deletions: 1 }], totalAdditions: 3, totalDeletions: 1 };
    expect(gitStatusToFiles(input as never, stat)).toEqual([
      { path: 'a.ts', status: 'modified', additions: 0, deletions: 0 },
    ]);
  });
});
