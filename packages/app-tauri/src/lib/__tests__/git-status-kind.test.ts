import { describe, it, expect } from 'vitest';
import { gitStatusKind } from '../git-status-kind';

describe('gitStatusKind', () => {
  it('maps single-char XY codes', () => {
    expect(gitStatusKind('A')).toBe('added');
    expect(gitStatusKind('??')).toBe('added');
    expect(gitStatusKind('D')).toBe('deleted');
    expect(gitStatusKind('M')).toBe('modified');
    expect(gitStatusKind('R')).toBe('renamed');
    expect(gitStatusKind('C')).toBe('renamed');
  });

  it('maps multi-char XY pairs (index + worktree)', () => {
    expect(gitStatusKind('MM')).toBe('modified');
    expect(gitStatusKind('AM')).toBe('added');
    expect(gitStatusKind('RM')).toBe('renamed');
  });
});
