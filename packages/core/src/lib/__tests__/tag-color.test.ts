import { describe, it, expect } from 'vitest';
import { TAG_PALETTE } from '@qlan-ro/mainframe-types';
import { hashTagColor } from '../tag-color.js';

describe('hashTagColor', () => {
  it('returns a palette color', () => {
    const c = hashTagColor('feature');
    expect(TAG_PALETTE).toContain(c);
  });
  it('is deterministic for the same name', () => {
    expect(hashTagColor('bug')).toBe(hashTagColor('bug'));
  });
  it('distributes across different names', () => {
    const colors = new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map(hashTagColor));
    expect(colors.size).toBeGreaterThan(1);
  });
});
