/**
 * Regression tests for the `chat.config.updated` reducer branch.
 *
 * The composer config toolbar was showing stale values when the daemon changed
 * chat config on its own (e.g. the agent exiting plan mode → planMode:false).
 * Fix: the controller now mirrors `chat.updated` into the `chatConfig` slice so
 * the toolbar always reads the daemon's latest values.
 *
 * All expected values are hardcoded. No reducer logic is re-derived here.
 */
import { describe, it, expect } from 'vitest';
import type { Chat } from '@qlan-ro/mainframe-types';
import { createChatThreadState, reduceChatThreadState } from '../chat-thread-state';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const chat = {
  id: 'c1',
  planMode: true,
  permissionMode: 'default',
  model: null,
} as unknown as Chat;

const chat2 = {
  id: 'c1',
  planMode: false,
  permissionMode: 'plan',
  model: 'opus',
} as unknown as Chat;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('reduceChatThreadState — chat.config.updated', () => {
  it('initial state has chatConfig set to null', () => {
    expect(createChatThreadState('c1').chatConfig).toBeNull();
  });

  it('chat.config.updated sets chatConfig to the event chat object', () => {
    const before = createChatThreadState('c1');
    const after = reduceChatThreadState(before, { type: 'chat.config.updated', chat });

    expect(after.chatConfig).toBe(chat);
    expect(after.chatConfig?.planMode).toBe(true);
  });

  it('a later chat.config.updated replaces the previous chatConfig', () => {
    const base = createChatThreadState('c1');
    const withFirst = reduceChatThreadState(base, { type: 'chat.config.updated', chat });
    const withSecond = reduceChatThreadState(withFirst, { type: 'chat.config.updated', chat: chat2 });

    expect(withSecond.chatConfig).toBe(chat2);
    expect(withSecond.chatConfig?.planMode).toBe(false);
    expect(withSecond.chatConfig?.permissionMode).toBe('plan');
  });

  it('does not disturb other state slices', () => {
    const before = createChatThreadState('c1');
    const after = reduceChatThreadState(before, { type: 'chat.config.updated', chat });

    expect(after.runState).toEqual({ type: 'idle' });
    expect(after.messageOrder).toEqual([]);
    expect(after.interactions).toBe(before.interactions);
  });
});
