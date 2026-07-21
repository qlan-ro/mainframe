import { describe, it, expect } from 'vitest';
import { tagColorValue, TAG_DOT_STYLE, TAG_CHIP_STYLE, TAG_CHIP_ACTIVE_STYLE } from '../tag-colors';
import { TAG_PALETTE, type TagColor } from '@qlan-ro/mainframe-types';

// Known exact oklch values, pinned so a regression in the color table is caught.
const KNOWN_OKLCH: Partial<Record<TagColor, string>> = {
  blue: 'oklch(0.65 0.18 250)',
  amber: 'oklch(0.78 0.16 75)',
};

describe('tagColorValue', () => {
  it.each(TAG_PALETTE)('returns a defined oklch string for %s', (color) => {
    const value = tagColorValue(color);
    expect(typeof value).toBe('string');
    expect(value).toMatch(/^oklch\(/);

    const known = KNOWN_OKLCH[color];
    if (known) expect(value).toBe(known);
  });
});

describe('tag style helpers', () => {
  it.each([
    {
      name: 'TAG_DOT_STYLE',
      fn: TAG_DOT_STYLE,
      color: 'green' as TagColor,
      expected: { backgroundColor: 'oklch(0.72 0.19 150)' },
    },
    {
      name: 'TAG_CHIP_STYLE',
      fn: TAG_CHIP_STYLE,
      color: 'blue' as TagColor,
      expected: {
        backgroundColor: 'color-mix(in oklch, oklch(0.65 0.18 250) 18%, transparent)',
        color: 'oklch(0.65 0.18 250)',
      },
    },
    {
      name: 'TAG_CHIP_ACTIVE_STYLE',
      fn: TAG_CHIP_ACTIVE_STYLE,
      color: 'blue' as TagColor,
      expected: { backgroundColor: 'oklch(0.65 0.18 250)', color: 'white' },
    },
  ])('$name($color) returns the exact inline style object', ({ fn, color, expected }) => {
    expect(fn(color)).toEqual(expected);
  });
});
