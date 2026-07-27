/**
 * Compatibility contract for `insertDirective`.
 *
 * Pinned to assistant-ui 0.14.27's `triggerSelectionResource.selectItem`:
 *   before = text.slice(0, trigger.offset)
 *   after  = text.slice(trigger.offset + triggerChar.length + trigger.query.length)
 *   next   = before + directive + (after.startsWith(' ') ? after : ' ' + after)
 *
 * `appendSpace: false` is our addition — it reproduces the net effect of the
 * deleted `dropDirectoryClosingSpace` workaround without a post-hoc string fix.
 */
import { describe, it, expect } from 'vitest';
import { insertDirective } from '../selection';
import { detectTrigger } from '../detect';

describe('insertDirective', () => {
  it('replaces the token and appends exactly one trailing space', () => {
    expect(insertDirective('/', '/', { query: '', offset: 0 }, '/my-skill')).toEqual({
      text: '/my-skill ',
      cursor: 10,
    });
  });

  it('replaces a partially typed query', () => {
    expect(insertDirective('/my-sk', '/', { query: 'my-sk', offset: 0 }, '/my-skill')).toEqual({
      text: '/my-skill ',
      cursor: 10,
    });
  });

  it('preserves text before the trigger and places the cursor after the space', () => {
    expect(insertDirective('hey @sr', '@', { query: 'sr', offset: 4 }, '@src/a.ts')).toEqual({
      text: 'hey @src/a.ts ',
      cursor: 14,
    });
  });

  it('does not double the separator when the following text already starts with a space', () => {
    expect(insertDirective('@sr rest', '@', { query: 'sr', offset: 0 }, '@src/a.ts')).toEqual({
      text: '@src/a.ts rest',
      cursor: 10,
    });
  });

  it('inserts the separator when the following text does not start with a space', () => {
    expect(insertDirective('@sr,rest', '@', { query: 'sr,rest', offset: 0 }, '@src/a.ts')).toEqual({
      text: '@src/a.ts ',
      cursor: 10,
    });
  });

  it('only consumes the query, leaving text the cursor had not reached', () => {
    expect(insertDirective('@sr tail', '@', { query: 'sr', offset: 0 }, '@agent')).toEqual({
      text: '@agent tail',
      cursor: 7,
    });
  });

  describe('appendSpace: false (directory drill-down)', () => {
    it('appends no space at the end of the input', () => {
      expect(insertDirective('@x/', '@', { query: 'x/', offset: 0 }, '@x/sub/', { appendSpace: false })).toEqual({
        text: '@x/sub/',
        cursor: 7,
      });
    });

    it('leaves following text untouched mid-input', () => {
      expect(insertDirective('@x/ rest', '@', { query: 'x/', offset: 0 }, '@x/sub/', { appendSpace: false })).toEqual({
        text: '@x/sub/ rest',
        cursor: 7,
      });
    });

    it('leaves the @dir/ token open for re-detection at the new cursor', () => {
      const { text, cursor } = insertDirective('@x/', '@', { query: 'x/', offset: 0 }, '@x/sub/', {
        appendSpace: false,
      });
      expect(detectTrigger(text, '@', cursor)).toEqual({ query: 'x/sub/', offset: 0 });
    });
  });

  it('closes the token when a space IS appended (no re-detection)', () => {
    const { text, cursor } = insertDirective('/', '/', { query: '', offset: 0 }, '/my-skill');
    expect(detectTrigger(text, '/', cursor)).toBeNull();
  });
});
