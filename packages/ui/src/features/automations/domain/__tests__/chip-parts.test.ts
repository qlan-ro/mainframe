import { describe, expect, it } from 'vitest';
import { isTokenPart, mergeDraftTail, partsToPlainText } from '../chip-parts';

describe('isTokenPart', () => {
  it('distinguishes a token part from a literal string part', () => {
    expect(isTokenPart('hello')).toBe(false);
    expect(isTokenPart({ token: { stepId: 'a', output: 'b' } })).toBe(true);
  });
});

describe('mergeDraftTail', () => {
  it('appends the draft into the trailing string part', () => {
    expect(mergeDraftTail(['abc'], 'def')).toEqual(['abcdef']);
  });

  it('pushes a new string part when the tail is a token', () => {
    const token = { token: { stepId: 'a', output: 'b' } };
    expect(mergeDraftTail([token], 'def')).toEqual([token, 'def']);
  });

  it('pushes a new string part when there are no parts yet', () => {
    expect(mergeDraftTail([], 'abc')).toEqual(['abc']);
  });

  it('returns the parts unchanged when the draft is empty', () => {
    const parts = ['abc'];
    expect(mergeDraftTail(parts, '')).toBe(parts);
  });
});

describe('partsToPlainText', () => {
  it('renders literal text as-is and resolves each token through the given label lookup', () => {
    const parts = ['Hello ', { token: { stepId: 'a', output: 'b' } }, '!'];
    expect(partsToPlainText(parts, () => 'Name')).toBe('Hello ⟨Name⟩!');
  });
});
