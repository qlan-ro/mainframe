/**
 * Behavior tests for sanitizeReferenceLabel / disambiguateLabels / nextFreeLabel / labelSlug.
 *
 * Every case pins a fixed input to a concrete, hardcoded output — none of the
 * sanitizing/disambiguation logic is re-derived here.
 */
import { describe, it, expect } from 'vitest';
import {
  UNTITLED_SESSION_LABEL,
  sanitizeReferenceLabel,
  disambiguateLabels,
  nextFreeLabel,
  labelSlug,
} from '../reference-label';

describe('sanitizeReferenceLabel', () => {
  it('keeps letters, digits, spaces, and the punctuation , ; ! ? \' " ( ) -', () => {
    const input = `Wow, "cool"; nice! really? (yes) - ok 123`;
    expect(sanitizeReferenceLabel(input)).toBe(input);
  });

  it.each([
    ['Why does `useEffect` fire twice', 'Why does useEffect fire twice'],
    ['Fix *foo* handling', 'Fix foo handling'],
    ['Fix _foo_ [bar] <baz> ~~qux~~', 'Fix foo bar baz qux'],
    ['See www.example.com now', 'See www example com now'],
    ['Ping name@example.com', 'Ping name example com'],
    ['A | B # C \\ D & E', 'A B C D E'],
    ['Truncated title…', 'Truncated title…'],
  ])('sanitizes %j to %j', (input, expected) => {
    expect(sanitizeReferenceLabel(input)).toBe(expected);
  });

  it('collapses internal whitespace runs and trims the ends', () => {
    expect(sanitizeReferenceLabel('  a \n\t b  ')).toBe('a b');
  });

  it('falls back to the untitled label when sanitizing leaves nothing', () => {
    expect(sanitizeReferenceLabel(undefined)).toBe(UNTITLED_SESSION_LABEL);
    expect(sanitizeReferenceLabel('')).toBe(UNTITLED_SESSION_LABEL);
    expect(sanitizeReferenceLabel('***')).toBe(UNTITLED_SESSION_LABEL);
    expect(sanitizeReferenceLabel('🎉🎉')).toBe(UNTITLED_SESSION_LABEL);
  });

  it('exposes the untitled label as "Untitled session"', () => {
    expect(UNTITLED_SESSION_LABEL).toBe('Untitled session');
  });
});

describe('disambiguateLabels', () => {
  it('numbers repeated labels in list order without mutating its input', () => {
    const entries = [
      { chatId: 'c1', label: 'Foo' },
      { chatId: 'c2', label: 'Foo' },
      { chatId: 'c3', label: 'Bar' },
      { chatId: 'c4', label: 'Foo' },
    ];
    const snapshot = entries.map((e) => ({ ...e }));

    const result = disambiguateLabels(entries);

    expect(result).toEqual(
      new Map([
        ['c1', 'Foo'],
        ['c2', 'Foo (2)'],
        ['c3', 'Bar'],
        ['c4', 'Foo (3)'],
      ]),
    );
    expect(entries).toEqual(snapshot);
  });
});

describe('nextFreeLabel', () => {
  it('returns the base label unchanged when it is free', () => {
    expect(nextFreeLabel('Foo', new Set())).toBe('Foo');
  });

  it('returns "Foo (2)" when "Foo" is already taken', () => {
    expect(nextFreeLabel('Foo', new Set(['Foo']))).toBe('Foo (2)');
  });

  it('returns "Foo (3)" when "Foo" and "Foo (2)" are both taken', () => {
    expect(nextFreeLabel('Foo', new Set(['Foo', 'Foo (2)']))).toBe('Foo (3)');
  });
});

describe('labelSlug', () => {
  it.each([
    ['Foo Bar (2)', 'foo-bar-2'],
    ['  a!!b  ', 'a-b'],
    ['Untitled session', 'untitled-session'],
  ])('slugifies %j to %j', (input, expected) => {
    expect(labelSlug(input)).toBe(expected);
  });
});
