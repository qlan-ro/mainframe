/**
 * session-tabs store — the DRAFT slot, the third one: a temporary tab that
 * activating another session does NOT replace, so an unsent draft survives a
 * peek at history. (The pinned set and the preview slot live in store.test.ts,
 * which is at its size limit.)
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { useSessionTabsStore } from '../store';

const pinned = () => useSessionTabsStore.getState().tabIds;
const preview = () => useSessionTabsStore.getState().previewId;
const draft = () => useSessionTabsStore.getState().draftId;

beforeEach(() => {
  useSessionTabsStore.setState({ tabIds: [], previewId: null, draftId: null, hydrated: false });
});

describe('ensureTab', () => {
  it('opens a draft in its own slot, leaving the peek and the pins alone', () => {
    useSessionTabsStore.setState({ tabIds: ['a'], previewId: 'p' });

    useSessionTabsStore.getState().ensureTab('__LOCALID_1', 'draft');

    expect(draft()).toBe('__LOCALID_1');
    expect(preview()).toBe('p');
    expect(pinned()).toEqual(['a']);
  });

  it('keeps the draft when another session is activated', () => {
    // The protection rule: the peek lands in the preview slot instead.
    useSessionTabsStore.setState({ draftId: '__LOCALID_1' });

    useSessionTabsStore.getState().ensureTab('chat-a');

    expect(draft()).toBe('__LOCALID_1');
    expect(preview()).toBe('chat-a');
  });

  it('is idempotent for the draft that is already open', () => {
    useSessionTabsStore.setState({ draftId: '__LOCALID_1' });
    const before = useSessionTabsStore.getState();

    useSessionTabsStore.getState().ensureTab('__LOCALID_1', 'draft');

    expect(useSessionTabsStore.getState()).toBe(before);
  });
});

describe('pinTab', () => {
  it('promotes the draft into the pinned set and empties the slot', () => {
    // "Keep open" on a draft survives its first send: nothing demotes a pin.
    useSessionTabsStore.setState({ tabIds: ['a'], draftId: '__LOCALID_1' });

    useSessionTabsStore.getState().pinTab('__LOCALID_1');

    expect(pinned()).toEqual(['a', '__LOCALID_1']);
    expect(draft()).toBeNull();
  });
});

describe('closeTab', () => {
  it('clears only the draft slot when the draft is closed', () => {
    useSessionTabsStore.setState({ tabIds: ['a'], previewId: 'p', draftId: '__LOCALID_1' });

    useSessionTabsStore.getState().closeTab('__LOCALID_1');

    expect(draft()).toBeNull();
    expect(preview()).toBe('p');
    expect(pinned()).toEqual(['a']);
  });
});

describe('reconcile', () => {
  it('writes the resolved three-slot state', () => {
    useSessionTabsStore.setState({ tabIds: ['a', 'gone'], previewId: 'stale', draftId: '__LOCALID_1' });

    useSessionTabsStore.getState().reconcile((s) => ({
      tabIds: s.tabIds.filter((id) => id !== 'gone'),
      previewId: s.draftId,
      draftId: null,
    }));

    expect(pinned()).toEqual(['a']);
    expect(preview()).toBe('__LOCALID_1');
    expect(draft()).toBeNull();
  });

  it('leaves the state object untouched when only the draft slot is re-resolved to itself', () => {
    // Identity matters: reconcile runs on every thread-list tick, and a fresh
    // object each time would re-render the whole strip while a chat streams.
    useSessionTabsStore.setState({ tabIds: ['a'], previewId: 'p', draftId: '__LOCALID_1' });
    const before = useSessionTabsStore.getState();

    useSessionTabsStore.getState().reconcile((s) => ({ ...s, tabIds: [...s.tabIds] }));

    expect(useSessionTabsStore.getState()).toBe(before);
  });

  it('writes new state when only the draft slot changed', () => {
    useSessionTabsStore.setState({ tabIds: ['a'], previewId: 'p', draftId: '__LOCALID_1' });

    useSessionTabsStore.getState().reconcile((s) => ({ ...s, draftId: null }));

    expect(draft()).toBeNull();
    expect(pinned()).toEqual(['a']);
    expect(preview()).toBe('p');
  });
});
