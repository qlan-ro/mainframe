/**
 * Behavior tests for composeReferenceLines / parseReferenceLine /
 * collectSessionTokenLabels / prependSessionReferences.
 *
 * Every case pins a fixed input to a concrete, hardcoded output — none of the
 * compose/parse logic is re-derived here. `stripReferenceLines` is tested in
 * `markers/__tests__/message-markers.test.ts`; only the prepend→strip round
 * trips stay here, where the pair they pin lives.
 */
import { describe, it, expect } from 'vitest';
import { stripReferenceLines } from '../../markers/message-markers';
import {
  composeReferenceLines,
  parseReferenceLine,
  collectSessionTokenLabels,
  prependSessionReferences,
} from '../reference-line';

describe('composeReferenceLines / parseReferenceLine round trip', () => {
  it.each([
    { label: 'Foo Bar', path: '/tmp/foo-bar.jsonl' },
    { label: 'Foo (2)', path: '/tmp/foo-2.jsonl' },
    { label: `Nice, "quote"; ok! really? (yes) - done`, path: '/tmp/nice.jsonl' },
  ])('round-trips $label', ({ label, path }) => {
    const line = composeReferenceLines([{ label, path }]).trimEnd();
    expect(parseReferenceLine(line)).toEqual({ label, path });
  });

  it('returns an empty string for an empty ref list', () => {
    expect(composeReferenceLines([])).toBe('');
  });

  it('produces lines matching "Referenced session @session[label]: /path"', () => {
    const lines = composeReferenceLines([
      { label: 'Foo', path: '/tmp/a.jsonl' },
      { label: 'Bar Baz', path: '/tmp/b.jsonl' },
    ]).split('\n');

    expect(lines).toEqual([
      'Referenced session @session[Foo]: /tmp/a.jsonl',
      'Referenced session @session[Bar Baz]: /tmp/b.jsonl',
    ]);
    for (const line of lines) {
      expect(line).toMatch(/^Referenced session @session\[[^\]\n]*\]: \/.+$/);
    }
  });
});

describe('collectSessionTokenLabels', () => {
  it('collects unique labels in order of first appearance', () => {
    expect(collectSessionTokenLabels('a @session[Foo] b @session[Bar] c @session[Foo]')).toEqual(['Foo', 'Bar']);
  });

  it('does not match a token glued to a preceding word', () => {
    expect(collectSessionTokenLabels('email@session[x]')).toEqual([]);
  });
});

describe('prependSessionReferences', () => {
  it('prepends one reference line above the body, leaving the body unchanged', () => {
    const body = 'look at @session[Foo] please';
    const result = prependSessionReferences(body, new Map([['Foo', '/tmp/foo.jsonl']]));
    expect(result).toBe('Referenced session @session[Foo]: /tmp/foo.jsonl\n\n' + body);
  });

  it('emits exactly one line for two tokens sharing the same label', () => {
    const body = '@session[Foo] and again @session[Foo]';
    const result = prependSessionReferences(body, new Map([['Foo', '/tmp/foo.jsonl']]));
    expect(result).toBe('Referenced session @session[Foo]: /tmp/foo.jsonl\n\n' + body);
  });

  it('returns the body unchanged and does not throw for a token with no recorded path', () => {
    const body = 'hand typed @session[Nonexistent]';
    expect(() => prependSessionReferences(body, new Map())).not.toThrow();
    expect(prependSessionReferences(body, new Map())).toBe(body);
  });

  it('returns the body unchanged for an empty reference map', () => {
    const body = 'plain text, no tokens';
    expect(prependSessionReferences(body, new Map())).toBe(body);
  });

  it('places the reference block above a leading quote block', () => {
    const body = '> quoted\n\nrest @session[Foo]';
    const result = prependSessionReferences(body, new Map([['Foo', '/tmp/foo.jsonl']]));
    expect(result).toBe('Referenced session @session[Foo]: /tmp/foo.jsonl\n\n' + body);
  });

  it('handles a body that is only a session token', () => {
    const body = '@session[Foo]';
    const result = prependSessionReferences(body, new Map([['Foo', '/tmp/foo.jsonl']]));
    expect(result).toBe('Referenced session @session[Foo]: /tmp/foo.jsonl\n\n@session[Foo]');
  });

  it('keeps a leading slash command on its own line (decision D1)', () => {
    const body = '/review @session[Foo]';
    const result = prependSessionReferences(body, new Map([['Foo', '/tmp/foo.jsonl']]));
    expect(result).toBe('/review @session[Foo]\n\nReferenced session @session[Foo]: /tmp/foo.jsonl');
  });

  it('inserts the reference block below the command line and above the rest of a multi-line slash body (decision D1)', () => {
    const body = '/review @session[Foo]\nand this';
    const result = prependSessionReferences(body, new Map([['Foo', '/tmp/foo.jsonl']]));
    expect(result).toBe('/review @session[Foo]\n\nReferenced session @session[Foo]: /tmp/foo.jsonl\nand this');
  });

  it('keeps the offset-0 prepend for a body starting with ">" (a quote)', () => {
    const body = '> quoted @session[Foo]';
    const result = prependSessionReferences(body, new Map([['Foo', '/tmp/foo.jsonl']]));
    expect(result).toBe('Referenced session @session[Foo]: /tmp/foo.jsonl\n\n' + body);
  });

  it('keeps the offset-0 prepend for a body starting with any other non-slash character', () => {
    const body = 'hello @session[Foo]';
    const result = prependSessionReferences(body, new Map([['Foo', '/tmp/foo.jsonl']]));
    expect(result).toBe('Referenced session @session[Foo]: /tmp/foo.jsonl\n\n' + body);
  });
});

describe('prependSessionReferences → stripReferenceLines round trip', () => {
  it('round-trips a single-line slash body byte-identically (decision D1)', () => {
    const body = '/review @session[Foo]';
    const prepended = prependSessionReferences(body, new Map([['Foo', '/tmp/foo.jsonl']]));
    expect(stripReferenceLines(prepended)).toBe(body);
  });

  it('round-trips a multi-line slash body byte-identically with no blank line introduced (decision D1)', () => {
    const body = '/review @session[Foo]\nand this';
    const prepended = prependSessionReferences(body, new Map([['Foo', '/tmp/foo.jsonl']]));
    expect(stripReferenceLines(prepended)).toBe(body);
  });
});
