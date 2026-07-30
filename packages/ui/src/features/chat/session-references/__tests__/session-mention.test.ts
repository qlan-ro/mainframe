/**
 * session-mention — the draft `@<label>` spelling and its expansion to the wire
 * `@session[<label>]` form (#240). Expected values are written out, never
 * recomputed from the labels.
 */
import { describe, expect, it } from 'vitest';
import { expandSessionMentions, findSessionMentions } from '../session-mention';

describe('findSessionMentions', () => {
  it('finds a recorded label with spaces', () => {
    expect(findSessionMentions('look at @Model Identity now', ['Model Identity'])).toEqual([
      { start: 8, end: 23, label: 'Model Identity' },
    ]);
  });

  it('ignores an @token that is not a recorded label', () => {
    expect(findSessionMentions('see @src/app.ts and @Nope', ['Model Identity'])).toEqual([]);
  });

  it('ignores a label not preceded by whitespace (email, path fragment)', () => {
    expect(findSessionMentions('me@Foo', ['Foo'])).toEqual([]);
  });

  it('does not match a label that continues into a longer word', () => {
    expect(findSessionMentions('@Foobar', ['Foo'])).toEqual([]);
  });

  it('matches a label followed by punctuation', () => {
    expect(findSessionMentions('@Foo, then', ['Foo'])).toEqual([{ start: 0, end: 4, label: 'Foo' }]);
  });

  it('prefers the longer label when one is a prefix of the other', () => {
    expect(findSessionMentions('@Foo (2) here', ['Foo', 'Foo (2)'])).toEqual([{ start: 0, end: 8, label: 'Foo (2)' }]);
  });

  it('finds every occurrence, including a repeat of the same label', () => {
    expect(findSessionMentions('@Foo and @Bar and @Foo', ['Foo', 'Bar'])).toEqual([
      { start: 0, end: 4, label: 'Foo' },
      { start: 9, end: 13, label: 'Bar' },
      { start: 18, end: 22, label: 'Foo' },
    ]);
  });

  it('finds nothing when no labels are recorded', () => {
    expect(findSessionMentions('@Foo', [])).toEqual([]);
  });
});

describe('expandSessionMentions', () => {
  it('rewrites the draft spelling to the wire spelling', () => {
    expect(expandSessionMentions('look at @Model Identity now', ['Model Identity'])).toBe(
      'look at @session[Model Identity] now',
    );
  });

  it('rewrites every occurrence', () => {
    expect(expandSessionMentions('@Foo and @Bar and @Foo', ['Foo', 'Bar'])).toBe(
      '@session[Foo] and @session[Bar] and @session[Foo]',
    );
  });

  it('leaves an already-bracketed token alone', () => {
    expect(expandSessionMentions('see @session[Foo]', ['Foo'])).toBe('see @session[Foo]');
  });

  it('leaves a file mention alone', () => {
    expect(expandSessionMentions('see @src/app.ts', ['Foo'])).toBe('see @src/app.ts');
  });

  it('returns the text unchanged when nothing matches', () => {
    expect(expandSessionMentions('plain text', ['Foo'])).toBe('plain text');
  });

  it('keeps a leading slash command on line 1', () => {
    expect(expandSessionMentions('/review @Foo', ['Foo'])).toBe('/review @session[Foo]');
  });
});
