/**
 * Compatibility contract for `detectTrigger`.
 *
 * Every case here is pinned to the observed behavior of assistant-ui
 * 0.14.27's `primitives/composer/trigger/detectTrigger.ts`, which this module
 * replaces. Changing an expectation here changes composer behavior.
 */
import { describe, it, expect } from 'vitest';
import { detectTrigger } from '../detect';

describe('detectTrigger', () => {
  it('matches a trigger char at offset 0', () => {
    expect(detectTrigger('/', '/', 1)).toEqual({ query: '', offset: 0 });
  });

  it('returns the text between the trigger char and the cursor as the query', () => {
    expect(detectTrigger('/my-sk', '/', 6)).toEqual({ query: 'my-sk', offset: 0 });
  });

  it('matches a trigger char preceded by whitespace', () => {
    expect(detectTrigger('hello @src', '@', 10)).toEqual({ query: 'src', offset: 6 });
  });

  it('matches a trigger char preceded by a newline', () => {
    expect(detectTrigger('hello\n@src', '@', 10)).toEqual({ query: 'src', offset: 6 });
  });

  it('does not match a trigger char in the middle of a word', () => {
    expect(detectTrigger('foo@bar', '@', 7)).toBeNull();
  });

  it('does not match when the cursor sits before the trigger char', () => {
    expect(detectTrigger('hi @src', '@', 2)).toBeNull();
  });

  it('returns null when the text before the cursor contains no trigger char', () => {
    expect(detectTrigger('plain text', '@', 10)).toBeNull();
  });

  it('stops scanning at the first whitespace before the cursor', () => {
    expect(detectTrigger('@src more', '@', 9)).toBeNull();
  });

  it('ignores a mid-word trigger char and keeps scanning to a word-initial one', () => {
    expect(detectTrigger('@a@b', '@', 4)).toEqual({ query: 'a@b', offset: 0 });
  });

  it('uses the nearest word-initial trigger char when several tokens precede the cursor', () => {
    expect(detectTrigger('@one @two', '@', 9)).toEqual({ query: 'two', offset: 5 });
  });

  it('keeps slashes inside the query (directory drill-down)', () => {
    expect(detectTrigger('@src/lib/', '@', 9)).toEqual({ query: 'src/lib/', offset: 0 });
  });

  it('ignores text after the cursor', () => {
    expect(detectTrigger('@src trailing', '@', 4)).toEqual({ query: 'src', offset: 0 });
  });

  it('does not match a "/" trigger inside an "@" token (triggers stay mutually exclusive)', () => {
    expect(detectTrigger('@x/foo', '/', 6)).toBeNull();
  });

  it('does not match an "@" trigger inside a "/" token (triggers stay mutually exclusive)', () => {
    expect(detectTrigger('/x@foo', '@', 6)).toBeNull();
  });

  it('returns null at cursor 0', () => {
    expect(detectTrigger('@src', '@', 0)).toBeNull();
  });
});
