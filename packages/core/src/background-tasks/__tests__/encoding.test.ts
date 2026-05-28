import { describe, it, expect } from 'vitest';
import { encodeCwdSegment } from '../encoding.js';

describe('encodeCwdSegment', () => {
  it('encodes leading / as -, slashes as -', () => {
    expect(encodeCwdSegment('/Users/x/Projects/qlan/mainframe')).toBe('-Users-x-Projects-qlan-mainframe');
  });
  it('encodes dots as -, producing -- for /. transitions', () => {
    expect(encodeCwdSegment('/Users/x/Projects/qlan/mainframe/.worktrees/feat-bg-tasks')).toBe(
      '-Users-x-Projects-qlan-mainframe--worktrees-feat-bg-tasks',
    );
  });
  it('preserves hyphens', () => {
    expect(encodeCwdSegment('/Users/x/feat-bg-tasks')).toBe('-Users-x-feat-bg-tasks');
  });
  it('preserves underscores', () => {
    expect(encodeCwdSegment('/Users/x/Projects/blueprint/DBricks_Optimizer')).toBe(
      '-Users-x-Projects-blueprint-DBricks_Optimizer',
    );
  });
});
