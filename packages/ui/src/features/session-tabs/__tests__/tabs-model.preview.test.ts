/**
 * tabs-model — the preview slot's half of the pure layer (the pinned half lives
 * in tabs-model.test.ts, which is at its size limit).
 *
 * `reconcilePreviewId` is `reconcileTabIds` collapsed to one nullable id: same
 * canonicalisation, same validity rule. `shouldPinOnOpen` decides whether an
 * activation is a peek at history or a tab the user deliberately created.
 */
import { describe, expect, it } from 'vitest';
import type { ThreadListEntry } from '@/features/sessions/view-model/chat-to-thread-custom';
import { reconcilePreviewId, shouldPinOnOpen } from '../tabs-model';

/** A real session row: a regular thread-list entry, optionally remoteId-stamped. */
function entry(id: string, over: Partial<ThreadListEntry> = {}): ThreadListEntry {
  return { id, status: 'regular', ...over };
}

describe('reconcilePreviewId', () => {
  it('returns null for an empty slot', () => {
    expect(reconcilePreviewId(null, [entry('chat-a')], 'chat-a')).toBeNull();
  });

  it('keeps a live session as itself', () => {
    const items = [entry('chat-a', { custom: {} }), entry('chat-b', { custom: {} })];

    expect(reconcilePreviewId('chat-b', items, 'chat-a')).toBe('chat-b');
  });

  it('collapses the previewed draft onto its canonical session', () => {
    // Same local→remote handoff the pinned set does, in the single slot.
    const items = [
      entry('__LOCALID_9', { remoteId: 'chat-new' }),
      entry('chat-new', { custom: {}, title: 'Fix the parser' }),
    ];

    expect(reconcilePreviewId('__LOCALID_9', items, 'chat-new')).toBe('chat-new');
  });

  it('keeps the pre-handoff draft as itself when only the local entry exists', () => {
    const items = [entry('__LOCALID_9', { remoteId: 'chat-new' })];

    expect(reconcilePreviewId('__LOCALID_9', items, '__LOCALID_9')).toBe('__LOCALID_9');
  });

  it('empties the slot when the previewed thread vanished', () => {
    expect(reconcilePreviewId('chat-gone', [entry('chat-a')], 'chat-a')).toBeNull();
  });

  it('empties the slot when the previewed thread was archived', () => {
    const items = [entry('chat-a'), entry('chat-b', { status: 'archived' })];

    expect(reconcilePreviewId('chat-b', items, 'chat-a')).toBeNull();
  });

  it('keeps the ACTIVE unsent draft even though it is not a list row', () => {
    const items: ThreadListEntry[] = [entry('chat-a'), { id: '__LOCALID_1', status: 'new' }];

    expect(reconcilePreviewId('__LOCALID_1', items, '__LOCALID_1')).toBe('__LOCALID_1');
  });

  it('empties the slot holding an INACTIVE unsent draft — the boot-draft cleanup rule', () => {
    const items: ThreadListEntry[] = [entry('chat-a'), { id: '__LOCALID_1', status: 'new' }];

    expect(reconcilePreviewId('__LOCALID_1', items, 'chat-a')).toBeNull();
  });

  it('keeps a preview whose validity comes from the canonicalised active id', () => {
    // The router still points at the local id while the canonical entry exists;
    // the previewed session is that canonical entry.
    const items = [entry('__LOCALID_9', { remoteId: 'chat-new' }), entry('chat-new', { custom: {} })];

    expect(reconcilePreviewId('chat-new', items, '__LOCALID_9')).toBe('chat-new');
  });

  it('empties the slot when the thread list is empty and nothing is active', () => {
    expect(reconcilePreviewId('chat-a', [], null)).toBeNull();
  });
});

describe('shouldPinOnOpen', () => {
  it('pins a local draft id that has no thread-list entry yet', () => {
    expect(shouldPinOnOpen('__LOCALID_1', [])).toBe(true);
  });

  it('pins the unsent draft the user just created', () => {
    const items: ThreadListEntry[] = [{ id: '__LOCALID_1', status: 'new' }];

    expect(shouldPinOnOpen('__LOCALID_1', items)).toBe(true);
  });

  it('previews a SENT session re-opened by the local id it kept — only drafts pin', () => {
    const items = [entry('__LOCALID_1', { remoteId: 'chat-a' })];

    expect(shouldPinOnOpen('__LOCALID_1', items)).toBe(false);
  });

  it('previews an existing session opened from the sidebar', () => {
    const items = [entry('chat-a', { custom: {}, title: 'Fix the parser' })];

    expect(shouldPinOnOpen('chat-a', items)).toBe(false);
  });

  it('pins a status-new entry even when its id is not a local one', () => {
    const items: ThreadListEntry[] = [{ id: 'chat-a', status: 'new' }];

    expect(shouldPinOnOpen('chat-a', items)).toBe(true);
  });

  it('previews an id with no entry at all', () => {
    expect(shouldPinOnOpen('chat-a', [])).toBe(false);
  });

  it('previews an archived session', () => {
    const items = [entry('chat-a', { status: 'archived', custom: {} })];

    expect(shouldPinOnOpen('chat-a', items)).toBe(false);
  });

  it('matches on the entry id only — a remoteId hit does not pin', () => {
    // The seam passes the ACTIVE id; the canonical entry is the one that counts.
    const items: ThreadListEntry[] = [{ id: '__LOCALID_1', status: 'new', remoteId: 'chat-a' }];

    expect(shouldPinOnOpen('chat-a', items)).toBe(false);
  });
});
