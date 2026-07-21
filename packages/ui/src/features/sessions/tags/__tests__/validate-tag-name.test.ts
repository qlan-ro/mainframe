import { describe, it, expect } from 'vitest';
import { validateTagName, tagNameErrorMessage, type TagNameError } from '../validate-tag-name';

describe('validateTagName', () => {
  it.each<[string, TagNameError | null]>([
    ['alpha', null],
    ['AB', null],
    ['  alpha  ', null],
    ['a', 'too-short'],
    ['x'.repeat(25), 'too-long'],
    ['mf:system', 'reserved-prefix'],
    ['bad name', 'invalid-chars'],
  ])('returns %j for %j', (input, expected) => {
    expect(validateTagName(input)).toBe(expected);
  });
});

describe('tagNameErrorMessage', () => {
  it.each<[TagNameError, string]>([
    ['reserved-prefix', 'Tag names may not use the mf: prefix'],
    ['too-short', 'Tag name must be at least 2 characters'],
    ['too-long', 'Tag name must be 24 characters or fewer'],
    ['invalid-chars', 'Only lowercase letters, numbers, and hyphens allowed'],
  ])('returns the exact message for %s', (code, expected) => {
    expect(tagNameErrorMessage(code)).toBe(expected);
  });
});
