/**
 * Regression tests for the `chat.id.adopted` reducer branch.
 *
 * Bug: a new thread's aui item id is `__LOCALID_*` for life. On first send,
 * `ChatThreadController.setRemoteId` updated only the private `daemonId` field —
 * `state.chatId` (part of the public snapshot read by `useChatExtras().state`)
 * never flipped to the real daemon id. Every stale-id consumer downstream
 * (composer tuning PATCHes, the diff-expand fetch, the `@`-file search scope)
 * kept targeting the dead `__LOCALID_*` id after the chat was created.
 *
 * Fix: a `chat.id.adopted` event lets the controller flip `state.chatId` to the
 * daemon id the moment `setRemoteId` resolves, so every consumer of
 * `extras.state.chatId` sees the real id from that point on.
 *
 * All expected values are hardcoded. No reducer logic is re-derived here.
 */
import { describe, it, expect } from 'vitest';
import { createChatThreadState, reduceChatThreadState } from '../chat-thread-state';

const LOCAL_ID = '__LOCALID_abc';
const REMOTE_ID = 'chat-real-1';

describe('reduceChatThreadState — chat.id.adopted', () => {
  it('flips chatId from the local id to the daemon id', () => {
    const before = createChatThreadState(LOCAL_ID);
    const after = reduceChatThreadState(before, { type: 'chat.id.adopted', chatId: REMOTE_ID });

    expect(after.chatId).toBe(REMOTE_ID);
  });

  it('is a no-op (same reference) when the id is already current', () => {
    const before = createChatThreadState(REMOTE_ID);
    const after = reduceChatThreadState(before, { type: 'chat.id.adopted', chatId: REMOTE_ID });

    expect(after).toBe(before);
  });

  it('does not disturb other state slices', () => {
    const before = createChatThreadState(LOCAL_ID);
    const after = reduceChatThreadState(before, { type: 'chat.id.adopted', chatId: REMOTE_ID });

    expect(after.runState).toEqual({ type: 'idle' });
    expect(after.messageOrder).toEqual([]);
    expect(after.interactions).toBe(before.interactions);
    expect(after.chatConfig).toBeNull();
  });
});
