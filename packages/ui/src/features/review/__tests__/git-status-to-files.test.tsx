import { describe, it, expect } from 'vitest';
import { gitStatusToFiles } from '../git-status-to-files';

describe('gitStatusToFiles', () => {
  it('maps a variety of real XY porcelain codes to semantic statuses', () => {
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
      { path: 'a.ts', status: 'added' },
      { path: 'b.ts', status: 'modified' },
      { path: 'c.ts', status: 'deleted' },
      { path: 'd.ts', status: 'renamed' },
      { path: 'e.ts', status: 'modified' },
      { path: 'f.ts', status: 'renamed' },
      { path: 'g.ts', status: 'added' },
    ]);
  });
});
