import { describe, it, expect } from 'vitest';
import { parseAtToken } from './parse-at-token';

describe('parseAtToken', () => {
  it('returns null when there is no @ before the caret', () => {
    expect(parseAtToken('hello world', 11)).toBeNull();
    expect(parseAtToken('', 0)).toBeNull();
  });

  it('returns fuzzy mode for @ with no slash', () => {
    expect(parseAtToken('hello @foo', 10)).toEqual({
      mode: 'fuzzy',
      query: 'foo',
      dir: '',
      leaf: '',
      startOffset: 6,
      endOffset: 10,
    });
  });

  it('returns fuzzy mode for @ alone (empty query)', () => {
    expect(parseAtToken('@', 1)).toEqual({
      mode: 'fuzzy',
      query: '',
      dir: '',
      leaf: '',
      startOffset: 0,
      endOffset: 1,
    });
  });

  it('returns autocomplete mode when token contains a slash', () => {
    expect(parseAtToken('@src/co', 7)).toEqual({
      mode: 'autocomplete',
      query: '',
      dir: 'src',
      leaf: 'co',
      startOffset: 0,
      endOffset: 7,
    });
  });

  it('handles trailing slash (empty leaf)', () => {
    expect(parseAtToken('@src/', 5)).toEqual({
      mode: 'autocomplete',
      query: '',
      dir: 'src',
      leaf: '',
      startOffset: 0,
      endOffset: 5,
    });
  });

  it('handles nested path', () => {
    expect(parseAtToken('hello @src/components/But', 25)).toEqual({
      mode: 'autocomplete',
      query: '',
      dir: 'src/components',
      leaf: 'But',
      startOffset: 6,
      endOffset: 25,
    });
  });

  it('handles token starting with slash (project root)', () => {
    expect(parseAtToken('@/', 2)).toEqual({
      mode: 'autocomplete',
      query: '',
      dir: '.',
      leaf: '',
      startOffset: 0,
      endOffset: 2,
    });
    expect(parseAtToken('@/src', 5)).toEqual({
      mode: 'autocomplete',
      query: '',
      dir: '.',
      leaf: 'src',
      startOffset: 0,
      endOffset: 5,
    });
  });

  it('returns null when caret is before the @ token', () => {
    expect(parseAtToken('hello @foo bar', 4)).toBeNull();
  });

  it('requires @ to be at start of line or after whitespace', () => {
    expect(parseAtToken('foo@bar', 7)).toBeNull();
  });

  it('stops the token at the next whitespace', () => {
    expect(parseAtToken('@foo bar', 8)).toBeNull();
  });

  it('preserves @ at start of line', () => {
    expect(parseAtToken('@foo', 4)).toEqual({
      mode: 'fuzzy',
      query: 'foo',
      dir: '',
      leaf: '',
      startOffset: 0,
      endOffset: 4,
    });
  });
});
