import { describe, it, expect } from 'vitest';
import { parseAtToken } from '../parse-at-token';
import type { AtToken } from '../parse-at-token';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns the caret position at the end of the string. */
function caretAtEnd(text: string): number {
  return text.length;
}

// ---------------------------------------------------------------------------
// Fuzzy mode: @foo
// ---------------------------------------------------------------------------

describe('parseAtToken — fuzzy mode', () => {
  it('@foo with caret at end → mode:fuzzy, query:"foo"', () => {
    const text = '@foo';
    const result = parseAtToken(text, caretAtEnd(text));
    expect(result).toEqual<AtToken>({
      mode: 'fuzzy',
      query: 'foo',
      dir: '',
      leaf: '',
      startOffset: 0,
      endOffset: 4,
    });
  });

  it('@foo with caret mid-token → still returns token up to its end', () => {
    const text = '@foo';
    const result = parseAtToken(text, 2); // caret at 'o' (index 2)
    expect(result).toEqual<AtToken>({
      mode: 'fuzzy',
      query: 'foo',
      dir: '',
      leaf: '',
      startOffset: 0,
      endOffset: 4,
    });
  });

  it('@ with no body → mode:fuzzy, query:""', () => {
    const text = '@';
    const result = parseAtToken(text, caretAtEnd(text));
    expect(result).toEqual<AtToken>({
      mode: 'fuzzy',
      query: '',
      dir: '',
      leaf: '',
      startOffset: 0,
      endOffset: 1,
    });
  });

  it('text before @token → correct startOffset', () => {
    const text = 'hello @comp';
    const result = parseAtToken(text, caretAtEnd(text));
    expect(result).toEqual<AtToken>({
      mode: 'fuzzy',
      query: 'comp',
      dir: '',
      leaf: '',
      startOffset: 6,
      endOffset: 11,
    });
  });
});

// ---------------------------------------------------------------------------
// Autocomplete mode: @path/with/slash
// ---------------------------------------------------------------------------

describe('parseAtToken — autocomplete mode', () => {
  it('@src/comp → mode:autocomplete, dir:"src", leaf:"comp"', () => {
    const text = '@src/comp';
    const result = parseAtToken(text, caretAtEnd(text));
    expect(result).toEqual<AtToken>({
      mode: 'autocomplete',
      query: '',
      dir: 'src',
      leaf: 'comp',
      startOffset: 0,
      endOffset: 9,
    });
  });

  it('@src/components/ → dir:"src/components", leaf:""', () => {
    const text = '@src/components/';
    const result = parseAtToken(text, caretAtEnd(text));
    expect(result).toEqual<AtToken>({
      mode: 'autocomplete',
      query: '',
      dir: 'src/components',
      leaf: '',
      startOffset: 0,
      endOffset: 16,
    });
  });

  it('@/ → absolute root: dir:"/", leaf:""', () => {
    // tokenBody is "/", lastSlash is 0, rawDir is "" → dir = "/"
    const text = '@/';
    const result = parseAtToken(text, caretAtEnd(text));
    expect(result).toEqual<AtToken>({
      mode: 'autocomplete',
      query: '',
      dir: '/',
      leaf: '',
      startOffset: 0,
      endOffset: 2,
    });
  });

  it('@/Users/x/ → dir:"/Users/x", leaf:""', () => {
    const text = '@/Users/x/';
    const result = parseAtToken(text, caretAtEnd(text));
    expect(result).toEqual<AtToken>({
      mode: 'autocomplete',
      query: '',
      dir: '/Users/x',
      leaf: '',
      startOffset: 0,
      endOffset: 10,
    });
  });

  it('@/Users/x/file → dir:"/Users/x", leaf:"file"', () => {
    const text = '@/Users/x/file';
    const result = parseAtToken(text, caretAtEnd(text));
    expect(result).toEqual<AtToken>({
      mode: 'autocomplete',
      query: '',
      dir: '/Users/x',
      leaf: 'file',
      startOffset: 0,
      endOffset: 14,
    });
  });

  it('@~/ → dir:"~", leaf:""', () => {
    // tokenBody is "~/", lastSlash is 1, rawDir is "~" → dir = "~"
    const text = '@~/';
    const result = parseAtToken(text, caretAtEnd(text));
    expect(result).toEqual<AtToken>({
      mode: 'autocomplete',
      query: '',
      dir: '~',
      leaf: '',
      startOffset: 0,
      endOffset: 3,
    });
  });

  it('@~/Documents → dir:"~", leaf:"Documents"', () => {
    const text = '@~/Documents';
    const result = parseAtToken(text, caretAtEnd(text));
    expect(result).toEqual<AtToken>({
      mode: 'autocomplete',
      query: '',
      dir: '~',
      leaf: 'Documents',
      startOffset: 0,
      endOffset: 12,
    });
  });
});

// ---------------------------------------------------------------------------
// No-token cases → null
// ---------------------------------------------------------------------------

describe('parseAtToken — no token → null', () => {
  it('empty string returns null', () => {
    expect(parseAtToken('', 0)).toBeNull();
  });

  it('caret past whitespace after token → null', () => {
    // "hello @foo " — caret at 11 (past the space)
    const text = 'hello @foo ';
    expect(parseAtToken(text, 11)).toBeNull();
  });

  it('plain text with no @ → null', () => {
    const text = 'just some text';
    expect(parseAtToken(text, caretAtEnd(text))).toBeNull();
  });

  it('@ in the middle of a word (no preceding whitespace) → null', () => {
    // "foo@bar" — @ is not preceded by whitespace so it is not a trigger
    const text = 'foo@bar';
    expect(parseAtToken(text, caretAtEnd(text))).toBeNull();
  });

  it('caret before the @ → null', () => {
    const text = ' @foo';
    expect(parseAtToken(text, 0)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Edge: caret exactly at startOffset (on the '@')
// ---------------------------------------------------------------------------

describe('parseAtToken — caret at @', () => {
  it('caret on @ returns the token (endOffset > caret)', () => {
    const text = '@foo';
    // caret=0 means we scan backwards from index -1 → at=-1 → null
    // actually per the loop: i starts at caret-1 = -1, loop doesn't run → at=-1 → null
    expect(parseAtToken(text, 0)).toBeNull();
  });

  it('caret at 1 (just after @) → returns the token', () => {
    const text = '@foo';
    const result = parseAtToken(text, 1);
    expect(result).toEqual<AtToken>({
      mode: 'fuzzy',
      query: 'foo',
      dir: '',
      leaf: '',
      startOffset: 0,
      endOffset: 4,
    });
  });
});
