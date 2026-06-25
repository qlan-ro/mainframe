import { describe, it, expect } from 'vitest';
import { gitStatusKind, KIND_LABEL } from '../git-status-kind';

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

describe('KIND_LABEL', () => {
  it('provides a single-char display label for each semantic kind', () => {
    expect(KIND_LABEL['added']).toBe('A');
    expect(KIND_LABEL['modified']).toBe('M');
    expect(KIND_LABEL['deleted']).toBe('D');
    expect(KIND_LABEL['renamed']).toBe('R');
  });
});
