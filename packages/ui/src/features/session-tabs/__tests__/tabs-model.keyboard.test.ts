/**
 * The pure helpers the session-tab keyboard shortcuts sit on: the strip's
 * DISPLAYED order (the same order `SessionTabs.tsx` renders), index/next/prev
 * navigation over it (AC 10, AC 11), and the search for the next tab to open in
 * the workspace, which shares `canOpenBeside` with the tab strip's ⌘-click and
 * the context menu (AC 12).
 */
import { describe, expect, it } from 'vitest';
import { displayedTabIds, nextBesideId, nextTabId, tabAtIndex, tabHintIndex, type TabsState } from '../tabs-model';

describe('displayedTabIds', () => {
  it('concatenates pinned tabs, the preview, then the draft', () => {
    const state: TabsState = { tabIds: ['a', 'b', 'c'], previewId: 'p', draftId: 'd' };

    expect(displayedTabIds(state)).toEqual(['a', 'b', 'c', 'p', 'd']);
  });

  it('drops null preview/draft slots', () => {
    const state: TabsState = { tabIds: ['a', 'b'], previewId: null, draftId: null };

    expect(displayedTabIds(state)).toEqual(['a', 'b']);
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

describe('nextBesideId — AC 12, shares canOpenBeside', () => {
  it('returns null with only one session open', () => {
    expect(nextBesideId(['a'], 'a')).toBeNull();
  });

  it('returns null when the conversation is an unsent draft', () => {
    expect(nextBesideId(['__LOCALID_x', 'b'], '__LOCALID_x')).toBeNull();
  });

  it('returns the nearest following session', () => {
    expect(nextBesideId(['a', 'b', 'c'], 'a')).toBe('b');
  });

  it('skips one that is in the workspace already, and wraps past the end', () => {
    expect(nextBesideId(['a', 'b', 'c'], 'b', (id) => id === 'c')).toBe('a');
  });

  it('skips a draft', () => {
    expect(nextBesideId(['a', '__LOCALID_x', 'c'], 'a')).toBe('c');
  });

  it('returns null when every other session is there', () => {
    expect(nextBesideId(['a', 'b'], 'a', () => true)).toBeNull();
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
});
