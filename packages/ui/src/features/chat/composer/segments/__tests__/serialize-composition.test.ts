/**
 * Hardcoded vectors for serializeComposition (spec §2.3). Every expected
 * string is a literal — never recomputed from the input.
 *
 * Vectors 2-4 migrate verbatim from the now-retired
 * parse-send-input-quote.test.ts (single-slot quote branch, spec §2.3
 * "single-quote equivalence").
 */
import { describe, it, expect } from 'vitest';
import { serializeComposition } from '../serialize-composition';
import type { Segment } from '../segment-model';

describe('serializeComposition', () => {
  it('spec worked example: two committed quote+comment segments, empty live box', () => {
    const committed: Segment[] = [
      { id: 's0', quote: 'quote A', text: 'first' },
      { id: 's1', quote: 'quote B\nline two', text: 'second' },
    ];
    const result = serializeComposition(committed, { quote: null, text: '' });
    expect(result).toBe('> quote A\n\nfirst\n\n> quote B\n> line two\n\nsecond');
  });

  it('single quote + comment, byte-equal to the retired parseSendInput output', () => {
    const result = serializeComposition([], { quote: 'the answer is 4', text: 'explain that' });
    expect(result).toBe('> the answer is 4\n\nexplain that');
  });

  it('multiline quote: "> " prefixes every line', () => {
    const result = serializeComposition([], { quote: 'line one\nline two', text: 'why' });
    expect(result).toBe('> line one\n> line two\n\nwhy');
  });

  it('quote with empty comment renders the blockquote alone', () => {
    const result = serializeComposition([], { quote: 'q', text: '' });
    expect(result).toBe('> q');
  });

  it('dismissed-quote prose: the paragraph alone, no ">" prefix', () => {
    const committed: Segment[] = [{ id: 's0', quote: null, text: 'intro' }];
    const result = serializeComposition(committed, { quote: null, text: '' });
    expect(result).toBe('intro');
  });

  it('quote-only send with an empty live box is non-empty (cannot send today)', () => {
    const result = serializeComposition([], { quote: 'Q', text: '' });
    expect(result).not.toBe('');
  });

  it('text typed before a quote is appended: prose first, quote after — never the reverse', () => {
    const committed: Segment[] = [{ id: 's0', quote: null, text: 'intro' }];
    const result = serializeComposition(committed, { quote: 'Q', text: '' });
    expect(result).toBe('intro\n\n> Q');
  });

  it('everything empty renders the empty string', () => {
    const result = serializeComposition([], { quote: null, text: '' });
    expect(result).toBe('');
  });

  it('no quote at all: the trimmed body unchanged', () => {
    const result = serializeComposition([], { quote: null, text: 'hello' });
    expect(result).toBe('hello');
  });
});
