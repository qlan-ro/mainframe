import { describe, it, expect } from 'vitest';
import { validateTagName } from '../validate-tag-name.js';

describe('validateTagName', () => {
  it.each([
    ['feature', { ok: true, normalized: 'feature' }],
    ['  Feature  ', { ok: true, normalized: 'feature' }],
    ['ui-bug', { ok: true, normalized: 'ui-bug' }],
    ['perf-2', { ok: true, normalized: 'perf-2' }],
  ])('accepts %s', (input, expected) => {
    expect(validateTagName(input)).toEqual(expected);
  });

  it.each([
    ['', 'empty'],
    ['a', 'too short'],
    ['a'.repeat(25), 'too long'],
    ['has-pr', 'reserved prefix'],
    ['has-anything', 'reserved prefix'],
    ['feature!', 'invalid characters'],
    ['white space', 'invalid characters'],
  ])('rejects %s', (input, _label) => {
    const result = validateTagName(input);
    expect(result.ok).toBe(false);
  });
});
