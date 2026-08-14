/**
 * The pure helpers the session-tab keyboard shortcuts sit on: the strip's
 * DISPLAYED order (fact 17 — the same order `SessionTabs.tsx` renders, split
 * members regrouped adjacently), index/next/prev navigation over it (AC 10,
 * AC 11), and the split-partner search that shares `canOpenInSplit` with the
 * tab strip's ⌘-click and the context menu (fact 18, AC 12).
 */
import { describe, expect, it } from 'vitest';
import { displayedTabIds, nextSplitPartner, nextTabId, tabAtIndex, tabHintIndex, type TabsState } from '../tabs-model';

describe('displayedTabIds — fact 17', () => {
  it('concatenates pinned tabs, the preview, then the draft when there is no split', () => {
    const state: TabsState = { tabIds: ['a', 'b', 'c'], previewId: 'p', draftId: 'd' };

    expect(displayedTabIds(state, null, 'a')).toEqual(['a', 'b', 'c', 'p', 'd']);
  });

  it('drops null preview/draft slots', () => {
    const state: TabsState = { tabIds: ['a', 'b'], previewId: null, draftId: null };

    expect(displayedTabIds(state, null, 'a')).toEqual(['a', 'b']);
  });

  it('regroups a visible split pair adjacently at the first member’s position', () => {
    const state: TabsState = { tabIds: ['a', 'b', 'c'], previewId: 'p', draftId: 'd' };

    expect(displayedTabIds(state, ['b', 'd'], 'b')).toEqual(['a', 'b', 'd', 'c', 'p']);
  });

  it('does not regroup when only one zone member is in the displayed set', () => {
    const state: TabsState = { tabIds: ['a', 'b', 'c'], previewId: null, draftId: null };

    expect(displayedTabIds(state, ['b', 'not-displayed'], 'b')).toEqual(['a', 'b', 'c']);
  });

  it('does not regroup when there is no split', () => {
    const state: TabsState = { tabIds: ['a', 'b', 'c'], previewId: null, draftId: null };

    expect(displayedTabIds(state, null, 'a')).toEqual(['a', 'b', 'c']);
  });
});

describe('tabAtIndex — AC 10', () => {
  it('returns the tab at a valid index', () => {
    const displayed = ['a', 'b', 'c'];

    expect(tabAtIndex(displayed, 0)).toBe('a');
    expect(tabAtIndex(displayed, 2)).toBe('c');
  });

  it('returns null when the index exceeds the tab count (⌃5 with three tabs)', () => {
    const displayed = ['a', 'b', 'c'];

    expect(tabAtIndex(displayed, 4)).toBeNull();
  });
});

describe('nextTabId — AC 11', () => {
  it('advances to the following tab', () => {
    expect(nextTabId(['a', 'b', 'c'], 'a', 1)).toBe('b');
  });

  it('wraps from the last tab to the first going forward', () => {
    expect(nextTabId(['a', 'b', 'c'], 'c', 1)).toBe('a');
  });

  it('wraps from the first tab to the last going backward', () => {
    expect(nextTabId(['a', 'b', 'c'], 'a', -1)).toBe('c');
  });

  it('retreats to the previous tab', () => {
    expect(nextTabId(['a', 'b', 'c'], 'b', -1)).toBe('a');
  });

  it('returns the same id with only one tab open', () => {
    expect(nextTabId(['a'], 'a', 1)).toBe('a');
    expect(nextTabId(['a'], 'a', -1)).toBe('a');
  });
});

describe('nextSplitPartner — AC 12, shares canOpenInSplit (fact 18)', () => {
  it('returns null with only one session open', () => {
    expect(nextSplitPartner(['a'], 'a', null)).toBeNull();
  });

  it('returns null when the active session is an unsent draft', () => {
    expect(nextSplitPartner(['__LOCALID_x', 'b'], '__LOCALID_x', null)).toBeNull();
  });

  it('returns null when the only two sessions already fill both split slots', () => {
    expect(nextSplitPartner(['a', 'b'], 'a', ['a', 'b'])).toBeNull();
  });

  it('returns the nearest following splittable id with no split open', () => {
    expect(nextSplitPartner(['a', 'b', 'c'], 'a', null)).toBe('b');
  });

  it('skips a following id already in the visible split before finding one that qualifies', () => {
    expect(nextSplitPartner(['a', 'b', 'c'], 'a', ['a', 'b'])).toBe('c');
  });

  it('wraps past the end to find a qualifying partner', () => {
    expect(nextSplitPartner(['a', 'b', 'c'], 'b', ['b', 'c'])).toBe('a');
  });
});

describe('tabHintIndex', () => {
  it('numbers the displayed order from 1', () => {
    expect(tabHintIndex(['a', 'b', 'c'], 'a')).toBe(1);
    expect(tabHintIndex(['a', 'b', 'c'], 'c')).toBe(3);
  });

  it('returns null for a session that is not an open tab', () => {
    expect(tabHintIndex(['a', 'b'], 'zzz')).toBeNull();
  });

  it('returns null past the ninth tab, which no chord reaches', () => {
    const displayed = ['t1', 't2', 't3', 't4', 't5', 't6', 't7', 't8', 't9', 't10'];

    expect(tabHintIndex(displayed, 't9')).toBe(9);
    expect(tabHintIndex(displayed, 't10')).toBeNull();
  });

  it('agrees with tabAtIndex — the number shown is the tab the chord opens', () => {
    const displayed = ['a', 'b', 'c'];

    for (const id of displayed) {
      const shown = tabHintIndex(displayed, id);
      expect(shown).not.toBeNull();
      expect(tabAtIndex(displayed, (shown as number) - 1)).toBe(id);
    }
  });

  it('follows the regrouped split order rather than the pin order', () => {
    const state: TabsState = { tabIds: ['a', 'b', 'c'], previewId: null, draftId: null };
    // 'c' joins 'a' at the front when the two are split, so it becomes ⌃2.
    const displayed = displayedTabIds(state, ['a', 'c'], 'a');

    expect(displayed).toEqual(['a', 'c', 'b']);
    expect(tabHintIndex(displayed, 'c')).toBe(2);
    expect(tabHintIndex(displayed, 'b')).toBe(3);
  });
});
