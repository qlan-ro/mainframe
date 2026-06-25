import { describe, it, expect } from 'vitest';
import { tagColorValue, TAG_DOT_STYLE } from '../tag-colors';
import { TAG_PALETTE } from '@qlan-ro/mainframe-types';

// ---------------------------------------------------------------------------
// tagColorValue — returns the exact oklch string for known colors
// ---------------------------------------------------------------------------

describe("tagColorValue — returns 'oklch(0.65 0.18 250)' for blue", () => {
  it('returns the exact color string for blue', () => {
    expect(tagColorValue('blue')).toBe('oklch(0.65 0.18 250)');
  });
});

describe("tagColorValue — returns 'oklch(0.78 0.16 75)' for amber", () => {
  it('returns the exact color string for amber', () => {
    expect(tagColorValue('amber')).toBe('oklch(0.78 0.16 75)');
  });
});

describe('tagColorValue — every TAG_PALETTE color has a defined oklch entry', () => {
  it('returns a string matching /^oklch\\(/ for every palette color', () => {
    for (const c of TAG_PALETTE) {
      expect(typeof tagColorValue(c)).toBe('string');
      expect(tagColorValue(c)).toMatch(/^oklch\(/);
    }
  });
});

// ---------------------------------------------------------------------------
// TAG_DOT_STYLE — returns a style object with the correct backgroundColor
// ---------------------------------------------------------------------------

describe("TAG_DOT_STYLE — returns { backgroundColor: 'oklch(0.72 0.19 150)' } for green", () => {
  it('returns the exact inline style object for green', () => {
    expect(TAG_DOT_STYLE('green')).toEqual({
      backgroundColor: 'oklch(0.72 0.19 150)',
    });
  });
});
