/**
 * tabs-model — `stripEntries`.
 *
 * D10: the pair entry is DERIVED from `zones-store`, not owned by tabs-model —
 * `zones-store` stays the source of truth for which two ids are split, and
 * this just folds them into one `StripEntry` at the first member's position
 * in the displayed order.
 */
import { describe, expect, it } from 'vitest';
import { stripEntries, type TabsState } from '../tabs-model';

function state(tabIds: readonly string[], over: Partial<TabsState> = {}): TabsState {
  return { tabIds, previewId: null, draftId: null, ...over };
}

describe('stripEntries — no split', () => {
  it('renders every displayed id as a lone tab when zones is null', () => {
    expect(stripEntries(state(['chat-a', 'chat-b']), null, 'chat-a')).toEqual([
      { kind: 'tab', id: 'chat-a' },
      { kind: 'tab', id: 'chat-b' },
    ]);
  });
});

describe('stripEntries — a visible pair', () => {
  it('fuses both members into one pair entry at the first member’s position', () => {
    const entries = stripEntries(state(['chat-a', 'chat-b', 'chat-c']), ['chat-a', 'chat-b'], 'chat-a');
    expect(entries).toEqual([
      { kind: 'pair', ids: ['chat-a', 'chat-b'], focused: 0, visible: true },
      { kind: 'tab', id: 'chat-c' },
    ]);
  });

  it('focuses segment 0 when the active id is the first member', () => {
    const entries = stripEntries(state(['chat-a', 'chat-b']), ['chat-a', 'chat-b'], 'chat-a');
    expect(entries[0]).toMatchObject({ kind: 'pair', focused: 0 });
  });

  it('focuses segment 1 when the active id is the second member', () => {
    const entries = stripEntries(state(['chat-a', 'chat-b']), ['chat-a', 'chat-b'], 'chat-b');
    expect(entries[0]).toMatchObject({ kind: 'pair', focused: 1 });
  });

  it('positions the pair at the first member’s slot, not the last', () => {
    const entries = stripEntries(state(['chat-x', 'chat-a', 'chat-y', 'chat-b']), ['chat-a', 'chat-b'], 'chat-a');
    expect(entries.map((e) => (e.kind === 'pair' ? 'pair' : e.id))).toEqual(['chat-x', 'pair', 'chat-y']);
  });
});

describe('stripEntries — a parked pair', () => {
  it('is NOT visible, and neither segment is focused, while a third session is active', () => {
    const entries = stripEntries(state(['chat-a', 'chat-b', 'chat-c']), ['chat-a', 'chat-b'], 'chat-c');
    expect(entries[0]).toEqual({ kind: 'pair', ids: ['chat-a', 'chat-b'], focused: 0, visible: false });
  });

  it('still fuses into one pair entry even while parked', () => {
    const entries = stripEntries(state(['chat-a', 'chat-b']), ['chat-a', 'chat-b'], 'chat-c');
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ kind: 'pair' });
  });
});

describe('stripEntries — no pair when a member is not displayed', () => {
  it('renders lone tabs when only one zone member is in the displayed set', () => {
    // chat-b is a zone member but closed (not in tabIds/preview/draft).
    const entries = stripEntries(state(['chat-a', 'chat-c']), ['chat-a', 'chat-b'], 'chat-a');
    expect(entries).toEqual([
      { kind: 'tab', id: 'chat-a' },
      { kind: 'tab', id: 'chat-c' },
    ]);
  });

  it('renders lone tabs when neither zone member is displayed', () => {
    const entries = stripEntries(state(['chat-c', 'chat-d']), ['chat-a', 'chat-b'], 'chat-c');
    expect(entries).toEqual([
      { kind: 'tab', id: 'chat-c' },
      { kind: 'tab', id: 'chat-d' },
    ]);
  });
});

describe('stripEntries — a pair the surface cannot fit', () => {
  it('reads as parked (not visible) when the surface is too narrow for two zones', () => {
    const entries = stripEntries(state(['a', 'b', 'c']), ['a', 'b'], 'a', false);
    expect(entries).toContainEqual({ kind: 'pair', ids: ['a', 'b'], focused: 0, visible: false });
  });

  it('is visible again once the surface fits', () => {
    const entries = stripEntries(state(['a', 'b', 'c']), ['a', 'b'], 'a', true);
    expect(entries).toContainEqual({ kind: 'pair', ids: ['a', 'b'], focused: 0, visible: true });
  });
});
