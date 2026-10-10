import { describe, it, expect } from 'vitest';
import { findByChatId } from '../use-session-items';

describe('findByChatId', () => {
  it('prefers the canonical item over the local draft item a reload left beside it', () => {
    const items = [
      { id: '__LOCALID_a', remoteId: 'chat_1', title: undefined },
      { id: 'chat_1', remoteId: 'chat_1', title: 'Codex Code Review' },
    ];
    expect(findByChatId(items, 'chat_1')?.title).toBe('Codex Code Review');
  });

  it('falls back to the local item until the reload adds the canonical one', () => {
    const items = [{ id: '__LOCALID_a', remoteId: 'chat_1', title: undefined }];
    expect(findByChatId(items, 'chat_1')?.id).toBe('__LOCALID_a');
  });

  it('returns undefined for an unknown chat', () => {
    expect(findByChatId([{ id: 'chat_2', remoteId: 'chat_2' }], 'chat_1')).toBeUndefined();
  });
});
