import { describe, expect, it } from 'vitest';
import type { ThreadListEntry } from '@/features/sessions/view-model/chat-to-thread-custom';
import { displayedTabIds, heldTabIds, stripEntries, tabHintIndex } from '../tabs-model';

const entry = (id: string, status = 'regular'): ThreadListEntry => ({ id, status, custom: {} }) as ThreadListEntry;
const items = [entry('a'), entry('b'), entry('c'), entry('gone', 'archived')];
const state = { tabIds: ['c'], previewId: null, draftId: null };
const pair: [string, string] = ['a', 'b'];

describe('held split members', () => {
  it('holds listed members that no slot shows', () => {
    expect(heldTabIds(state, pair, items)).toEqual(['a', 'b']);
  });

  it('skips pinned, preview and unlisted members', () => {
    expect(heldTabIds({ ...state, tabIds: ['a'] }, pair, items)).toEqual(['b']);
    expect(heldTabIds({ ...state, previewId: 'b' }, pair, items)).toEqual(['a']);
    expect(heldTabIds(state, ['a', 'gone'], items)).toEqual(['a']);
  });

  it('holds nothing once the pair is gone', () => {
    expect(heldTabIds(state, null, items)).toEqual([]);
  });

  it('displays each held member once, after pins, and regroups the pair', () => {
    const held = heldTabIds(state, pair, items);
    const shown = displayedTabIds({ ...state, heldIds: held }, pair, null);
    expect(shown).toEqual(['c', 'a', 'b']);
    expect(stripEntries({ ...state, heldIds: held }, pair, 'a')).toEqual([
      { kind: 'tab', id: 'c' },
      { kind: 'pair', ids: pair, focused: 0, visible: true },
    ]);
  });

  it('counts held members individually for keyboard and hint indexes', () => {
    const shown = displayedTabIds({ ...state, heldIds: ['a', 'b'] }, pair, null);
    expect(tabHintIndex(shown, 'b')).toBe(3);
  });
});
