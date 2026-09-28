import { describe, it, expect } from 'vitest';
import { sideChatPlacement } from '../side-chat-placement';

describe('sideChatPlacement', () => {
  it.each([
    { width: null, expected: 'below' },
    { width: 700, expected: 'below' },
    { width: 847, expected: 'below' },
    { width: 848, expected: 'beside' },
    { width: 1400, expected: 'beside' },
  ])('a $width px column places the side chat $expected', ({ width, expected }) => {
    expect(sideChatPlacement(width)).toBe(expected);
  });
});
