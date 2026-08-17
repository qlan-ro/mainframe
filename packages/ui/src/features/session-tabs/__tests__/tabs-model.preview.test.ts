/**
 * tabs-model — the preview slot's half of the pure layer (the pinned half lives
 * in tabs-model.test.ts, which is at its size limit).
 *
 * `reconcilePreviewId` is `reconcileTabIds` collapsed to one nullable id: same
 * canonicalisation, same validity rule. The protected draft slot and the
 * transitions between the three slots live in tabs-model.draft.test.ts.
 */
import { describe, expect, it } from 'vitest';
import type { ThreadListEntry } from '@/features/sessions/view-model/chat-to-thread-custom';
import { reconcilePreviewId } from '../tabs-model';

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
