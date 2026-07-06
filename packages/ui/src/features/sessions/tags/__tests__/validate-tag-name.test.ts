import { describe, it, expect } from 'vitest';
import { validateTagName, tagNameErrorMessage } from '../validate-tag-name';

// ---------------------------------------------------------------------------
// validateTagName — valid inputs return null
// ---------------------------------------------------------------------------

describe('validateTagName — returns null for a plain lowercase word', () => {
  it('returns null for "alpha"', () => {
    expect(validateTagName('alpha')).toBeNull();
  });
});

describe('validateTagName — returns null for uppercase input (server lowercases before checking)', () => {
  it('returns null for "AB"', () => {
    expect(validateTagName('AB')).toBeNull();
  });
});

describe('validateTagName — returns null when surrounding whitespace is trimmed to a valid name', () => {
  it('returns null for "  alpha  "', () => {
    expect(validateTagName('  alpha  ')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// validateTagName — invalid inputs return the expected error code
// ---------------------------------------------------------------------------

describe("validateTagName — returns 'too-short' for a single character", () => {
  it('returns "too-short" for "a"', () => {
    expect(validateTagName('a')).toBe('too-short');
  });
});

describe("validateTagName — returns 'too-long' for a 25-character string", () => {
  it('returns "too-long" for a 25-char string', () => {
    expect(validateTagName('x'.repeat(25))).toBe('too-long');
  });
});

describe("validateTagName — returns 'reserved-prefix' for names starting with 'mf:'", () => {
  it('returns "reserved-prefix" for "mf:system"', () => {
    expect(validateTagName('mf:system')).toBe('reserved-prefix');
  });
});

describe("validateTagName — returns 'invalid-chars' for names with spaces", () => {
  it('returns "invalid-chars" for "bad name"', () => {
    expect(validateTagName('bad name')).toBe('invalid-chars');
  });
});

// ---------------------------------------------------------------------------
// tagNameErrorMessage — returns exact human-readable strings
// ---------------------------------------------------------------------------

describe("tagNameErrorMessage — returns 'Tag names may not use the mf: prefix' for reserved-prefix", () => {
  it('returns the exact string for "reserved-prefix"', () => {
    expect(tagNameErrorMessage('reserved-prefix')).toBe('Tag names may not use the mf: prefix');
  });
});

describe("tagNameErrorMessage — returns 'Tag name must be at least 2 characters' for too-short", () => {
  it('returns the exact string for "too-short"', () => {
    expect(tagNameErrorMessage('too-short')).toBe('Tag name must be at least 2 characters');
  });
});

describe("tagNameErrorMessage — returns 'Tag name must be 24 characters or fewer' for too-long", () => {
  it('returns the exact string for "too-long"', () => {
    expect(tagNameErrorMessage('too-long')).toBe('Tag name must be 24 characters or fewer');
  });
});

describe("tagNameErrorMessage — returns 'Only lowercase letters, numbers, and hyphens allowed' for invalid-chars", () => {
  it('returns the exact string for "invalid-chars"', () => {
    expect(tagNameErrorMessage('invalid-chars')).toBe('Only lowercase letters, numbers, and hyphens allowed');
  });
});
