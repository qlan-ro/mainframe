import { describe, it, expect } from 'vitest';
import { applyIfNewer } from '../revision-merge.js';

describe('applyIfNewer', () => {
  it('applies a strictly-newer revision', () => {
    expect(applyIfNewer(2, 3)).toBe(true);
  });
  it('rejects equal/older', () => {
    expect(applyIfNewer(3, 3)).toBe(false);
    expect(applyIfNewer(3, 1)).toBe(false);
  });
  it('applies when no current revision', () => {
    expect(applyIfNewer(undefined, 1)).toBe(true);
  });
  it('rejects when incoming is undefined', () => {
    expect(applyIfNewer(1, undefined)).toBe(false);
  });
});
