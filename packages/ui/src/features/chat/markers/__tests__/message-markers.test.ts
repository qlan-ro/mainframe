/**
 * Behavior tests for the marker strippers and their composition. Every case
 * pins a fixed input to a hardcoded output; nothing re-derives the strip logic.
 */
import { describe, it, expect } from 'vitest';
import {
  SANDBOX_CAPTURE_SENTINEL,
  stripReferenceLines,
  stripSandboxCaptureBlock,
  visibleMessageText,
} from '../message-markers';

describe('stripReferenceLines', () => {
  it('strips a leading run of reference lines plus the following blank line', () => {
    const text =
      'Referenced session @session[Foo]: /tmp/foo.jsonl\n' +
      'Referenced session @session[Bar]: /tmp/bar.jsonl\n\n' +
      'look at this';
    expect(stripReferenceLines(text)).toBe('look at this');
  });

  it('strips a reference run that starts a later block (decision D1 layout)', () => {
    const text = '/review\n\nReferenced session @session[Foo]: /tmp/foo.jsonl\n\nrest';
    expect(stripReferenceLines(text)).toBe('/review\n\nrest');
  });

  it('leaves a reference-shaped line alone when it is preceded by a non-empty line', () => {
    const text = 'some prose\nReferenced session @session[Foo]: /tmp/foo.jsonl\nmore prose';
    expect(stripReferenceLines(text)).toBe(text);
  });

  it('is a no-op for text with no reference lines', () => {
    const text = 'just a plain message with @session[Foo] inline';
    expect(stripReferenceLines(text)).toBe(text);
  });

  it('returns an empty string for text that is only reference lines', () => {
    const text = 'Referenced session @session[Foo]: /tmp/foo.jsonl\nReferenced session @session[Bar]: /tmp/bar.jsonl';
    expect(stripReferenceLines(text)).toBe('');
  });
});

describe('stripSandboxCaptureBlock', () => {
  it('strips the sentinel, header, and rows, keeping the user text', () => {
    const text =
      SANDBOX_CAPTURE_SENTINEL +
      '\n> **Preview captures**\n' +
      '> - `element1` — selector `nav > .x`\n' +
      '> - `screenshot1` — "the gap"\n' +
      '\nfix the spacing';
    expect(stripSandboxCaptureBlock(text)).toBe('fix the spacing');
  });

  it("keeps a quote of the user's own that follows the capture rows", () => {
    const text = SANDBOX_CAPTURE_SENTINEL + '\n> **Preview captures**\n> - `element1`\n> like this?';
    expect(stripSandboxCaptureBlock(text)).toBe('> like this?');
  });

  it('is a no-op for text without the sentinel', () => {
    const text = '> **Preview captures**\n> - `element1`';
    expect(stripSandboxCaptureBlock(text)).toBe(text);
  });

  it('returns an empty string for a capture block with no user text', () => {
    expect(stripSandboxCaptureBlock(SANDBOX_CAPTURE_SENTINEL + '\n> **Preview captures**\n> - `element1`')).toBe('');
  });
});

describe('visibleMessageText', () => {
  it('strips both fenced blocks from one body', () => {
    const text =
      SANDBOX_CAPTURE_SENTINEL +
      '\n> **Preview captures**\n> - `element1`\n' +
      '\nReferenced session @session[Foo]: /tmp/foo.jsonl\n' +
      '\ncompare with @session[Foo]';
    expect(visibleMessageText(text)).toBe('compare with @session[Foo]');
  });

  it('is idempotent — already-clean text survives a second pass unchanged', () => {
    const text =
      SANDBOX_CAPTURE_SENTINEL +
      '\n> **Preview captures**\n> - `element1`\n' +
      '\nReferenced session @session[Foo]: /tmp/foo.jsonl\n\nwhy?';
    const once = visibleMessageText(text);
    expect(visibleMessageText(once)).toBe(once);
    expect(once).toBe('why?');
  });

  it('leaves an ordinary message untouched', () => {
    const text = 'Diff of `src/a.ts`\n\nAt line 4:\nwhy this cast?';
    expect(visibleMessageText(text)).toBe(text);
  });
});
