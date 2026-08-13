/**
 * tabs-model — the DRAFT slot: the third, protected temporary tab.
 *
 * A draft the user just created is kept while it is unsent (activating another
 * session must not throw away typing), and stops being protected the moment it
 * is sent: it demotes into the ordinary preview slot, where the next activation
 * replaces it. `reconcileTabs` is where that transition happens, because it
 * moves an id BETWEEN slots — something the per-slot resolvers cannot express.
 */
import { describe, expect, it } from 'vitest';
import type { ThreadListEntry } from '@/features/sessions/view-model/chat-to-thread-custom';
import { isDraftThread, reconcileTabs } from '../tabs-model';

/** A real session row: a regular thread-list entry, optionally remoteId-stamped. */
function entry(id: string, over: Partial<ThreadListEntry> = {}): ThreadListEntry {
  return { id, status: 'regular', ...over };
}

const EMPTY = { tabIds: [], previewId: null, draftId: null };

describe('isDraftThread', () => {
  it('is true for a local draft id that has no thread-list entry yet', () => {
    expect(isDraftThread('__LOCALID_1', [])).toBe(true);
  });

  it('is true for the unsent draft the user just created', () => {
    const items: ThreadListEntry[] = [{ id: '__LOCALID_1', status: 'new' }];

    expect(isDraftThread('__LOCALID_1', items)).toBe(true);
  });

  it('is false for a SENT session re-opened by the local id it kept', () => {
    const items = [entry('__LOCALID_1', { remoteId: 'chat-a' })];

    expect(isDraftThread('__LOCALID_1', items)).toBe(false);
  });

  it('is false for an existing session opened from the sidebar', () => {
    const items = [entry('chat-a', { custom: {}, title: 'Fix the parser' })];

    expect(isDraftThread('chat-a', items)).toBe(false);
  });

  it('is true for a status-new entry even when its id is not a local one', () => {
    const items: ThreadListEntry[] = [{ id: 'chat-a', status: 'new' }];

    expect(isDraftThread('chat-a', items)).toBe(true);
  });

  it('is false for a non-local id with no entry at all', () => {
    expect(isDraftThread('chat-a', [])).toBe(false);
  });

  it('is false for an archived session', () => {
    const items = [entry('chat-a', { status: 'archived', custom: {} })];

    expect(isDraftThread('chat-a', items)).toBe(false);
  });

  it('matches on the entry id only — a remoteId hit is not a draft', () => {
    const items: ThreadListEntry[] = [{ id: '__LOCALID_1', status: 'new', remoteId: 'chat-a' }];

    expect(isDraftThread('chat-a', items)).toBe(false);
  });
});

describe('reconcileTabs', () => {
  it('keeps the unsent draft while another session is active', () => {
    // The protection rule: peeking at a session does not discard the draft.
    const items: ThreadListEntry[] = [entry('chat-a', { custom: {} }), { id: '__LOCALID_1', status: 'new' }];

    const next = reconcileTabs({ tabIds: [], previewId: 'chat-a', draftId: '__LOCALID_1' }, items, 'chat-a');

    expect(next).toEqual({ tabIds: [], previewId: 'chat-a', draftId: '__LOCALID_1' });
  });

  it('keeps a brand-new draft that has no thread-list entry yet', () => {
    const items = [entry('chat-a', { custom: {} })];

    const next = reconcileTabs({ tabIds: ['chat-a'], previewId: null, draftId: '__LOCALID_1' }, items, 'chat-a');

    expect(next.draftId).toBe('__LOCALID_1');
  });

  it('demotes the draft into the preview slot once it is sent', () => {
    // The first send stamps the local entry regular: the tab stops being
    // protected and becomes THE temporary tab.
    const items = [entry('chat-a', { custom: {} }), entry('__LOCALID_1', { remoteId: 'chat-new' })];

    const next = reconcileTabs({ tabIds: [], previewId: 'chat-a', draftId: '__LOCALID_1' }, items, '__LOCALID_1');

    expect(next).toEqual({ tabIds: [], previewId: '__LOCALID_1', draftId: null });
  });

  it('demotes onto the canonical session id once the remote entry lands', () => {
    const items = [
      entry('__LOCALID_1', { remoteId: 'chat-new' }),
      entry('chat-new', { custom: {}, title: 'Fix the parser' }),
    ];

    const next = reconcileTabs({ tabIds: [], previewId: null, draftId: '__LOCALID_1' }, items, 'chat-new');

    expect(next).toEqual({ tabIds: [], previewId: 'chat-new', draftId: null });
  });

  it('drops the demoted draft when its session is already pinned', () => {
    // One session, one tab: the pin wins and the slot stays free.
    const items = [
      entry('__LOCALID_1', { remoteId: 'chat-new' }),
      entry('chat-new', { custom: {}, title: 'Fix the parser' }),
    ];

    const next = reconcileTabs({ tabIds: ['chat-new'], previewId: null, draftId: '__LOCALID_1' }, items, 'chat-new');

    expect(next).toEqual({ tabIds: ['chat-new'], previewId: null, draftId: null });
  });

  it('prunes the pinned set and the preview slot exactly as their own rules do', () => {
    const items = [entry('chat-a', { custom: {} })];

    const next = reconcileTabs(
      { tabIds: ['chat-a', 'chat-gone'], previewId: 'chat-archived', draftId: null },
      items,
      'chat-a',
    );

    expect(next).toEqual({ tabIds: ['chat-a'], previewId: null, draftId: null });
  });

  it('dissolves a preview that resolves onto a pinned session', () => {
    // The local→remote handoff can resolve both slots onto one session; the pin
    // wins so the strip never shows the same session twice.
    const items = [entry('__LOCALID_9', { remoteId: 'chat-new' }), entry('chat-new', { custom: {} })];

    const next = reconcileTabs({ tabIds: ['chat-new'], previewId: '__LOCALID_9', draftId: null }, items, 'chat-new');

    expect(next).toEqual({ tabIds: ['chat-new'], previewId: null, draftId: null });
  });

  it('leaves an empty strip empty', () => {
    expect(reconcileTabs(EMPTY, [], null)).toEqual(EMPTY);
  });
});
