import { describe, it, expect } from 'vitest';
import { TAG_PALETTE, RESERVED_TAG_PREFIX, SYNTHETIC_TAGS } from '../tags.js';

describe('tag constants', () => {
  it('TAG_PALETTE is non-empty and immutable', () => {
    expect(TAG_PALETTE.length).toBeGreaterThan(0);
    expect(Object.isFrozen(TAG_PALETTE)).toBe(true);
  });
  it('RESERVED_TAG_PREFIX is "has-"', () => {
    expect(RESERVED_TAG_PREFIX).toBe('has-');
  });
  it('SYNTHETIC_TAGS contains has-pr and has-worktree only', () => {
    expect([...SYNTHETIC_TAGS].sort()).toEqual(['has-pr', 'has-worktree']);
  });
});
