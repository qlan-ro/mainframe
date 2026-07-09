/**
 * Behavior tests for `reduceChatThreadState` — context.usage, compact.started,
 * and compact.done reducer branches (ChatSessionBar feature).
 *
 * All expected values are hardcoded. No reducer logic is re-derived here.
 */
import { describe, it, expect } from 'vitest';
import type { Chat } from '@qlan-ro/mainframe-types';
import { createChatThreadState, reduceChatThreadState } from '../chat-thread-state';

const CHAT_ID = 'c1';

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

describe('createChatThreadState — session-bar initial values', () => {
  it('initializes contextUsage to null', () => {
    expect(createChatThreadState(CHAT_ID).contextUsage).toBeNull();
  });

  it('initializes compacting to false', () => {
    expect(createChatThreadState(CHAT_ID).compacting).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// context.usage
// ---------------------------------------------------------------------------

describe('reduceChatThreadState — context.usage', () => {
  it('sets contextUsage to the event values', () => {
    const before = createChatThreadState(CHAT_ID);
    const after = reduceChatThreadState(before, {
      type: 'context.usage',
      percentage: 42,
      totalTokens: 84_000,
      maxTokens: 200_000,
    });

    expect(after.contextUsage).toEqual({
      percentage: 42,
      totalTokens: 84_000,
      maxTokens: 200_000,
    });
  });

  it('replaces an earlier contextUsage value with the newer one', () => {
    const base = createChatThreadState(CHAT_ID);
    const withFirst = reduceChatThreadState(base, {
      type: 'context.usage',
      percentage: 20,
      totalTokens: 40_000,
      maxTokens: 200_000,
    });
    const withSecond = reduceChatThreadState(withFirst, {
      type: 'context.usage',
      percentage: 75,
      totalTokens: 150_000,
      maxTokens: 200_000,
    });

    expect(withSecond.contextUsage).toEqual({
      percentage: 75,
      totalTokens: 150_000,
      maxTokens: 200_000,
    });
  });

  it('does not disturb other state slices', () => {
    const before = createChatThreadState(CHAT_ID);
    const after = reduceChatThreadState(before, {
      type: 'context.usage',
      percentage: 10,
      totalTokens: 20_000,
      maxTokens: 200_000,
    });

    expect(after.runState).toEqual({ type: 'idle' });
    expect(after.compacting).toBe(false);
    expect(after.interactions).toBe(before.interactions);
  });
});

// ---------------------------------------------------------------------------
// chat.config.updated — persisted context adoption (#197)
// ---------------------------------------------------------------------------

describe('reduceChatThreadState — chat.config.updated adopts persisted context usage', () => {
  const persistedChat = {
    id: CHAT_ID,
    adapterId: 'claude',
    lastContextTokensInput: 151_000,
    lastContextTotalTokens: 151_000,
    lastContextMaxTokens: 967_000,
  } as unknown as Chat;

  it('seeds contextUsage from the chat persisted totals when none is in memory', () => {
    const before = createChatThreadState(CHAT_ID);
    const after = reduceChatThreadState(before, { type: 'chat.config.updated', chat: persistedChat });

    expect(after.contextUsage).toEqual({
      percentage: (151_000 / 967_000) * 100,
      totalTokens: 151_000,
      maxTokens: 967_000,
    });
  });

  it('updates a stale in-memory contextUsage when newer persisted totals arrive (dormant-chat turn)', () => {
    const base = createChatThreadState(CHAT_ID);
    const withLive = reduceChatThreadState(base, {
      type: 'context.usage',
      percentage: 5,
      totalTokens: 50_000,
      maxTokens: 967_000,
    });
    const after = reduceChatThreadState(withLive, { type: 'chat.config.updated', chat: persistedChat });

    expect(after.contextUsage?.totalTokens).toBe(151_000);
    expect(after.contextUsage?.maxTokens).toBe(967_000);
  });

  it('keeps the live contextUsage object when the persisted totals match it', () => {
    const base = createChatThreadState(CHAT_ID);
    const withLive = reduceChatThreadState(base, {
      type: 'context.usage',
      percentage: 15.6,
      totalTokens: 151_000,
      maxTokens: 967_000,
    });
    const after = reduceChatThreadState(withLive, { type: 'chat.config.updated', chat: persistedChat });

    expect(after.contextUsage).toBe(withLive.contextUsage);
  });

  it('leaves contextUsage untouched when the chat has no persisted totals', () => {
    const chatWithout = { id: CHAT_ID, adapterId: 'claude', lastContextTokensInput: 10_000 } as unknown as Chat;
    const base = createChatThreadState(CHAT_ID);
    const after = reduceChatThreadState(base, { type: 'chat.config.updated', chat: chatWithout });

    expect(after.contextUsage).toBeNull();
    expect(after.chatConfig).toBe(chatWithout);
  });

  it('returns the SAME state reference when neither config nor persisted totals changed', () => {
    const base = createChatThreadState(CHAT_ID);
    const first = reduceChatThreadState(base, { type: 'chat.config.updated', chat: persistedChat });
    const again = reduceChatThreadState(first, { type: 'chat.config.updated', chat: { ...persistedChat } });

    expect(again).toBe(first);
  });
});

// ---------------------------------------------------------------------------
// compact.started
// ---------------------------------------------------------------------------

describe('reduceChatThreadState — compact.started', () => {
  it('sets compacting to true when it was false', () => {
    const before = createChatThreadState(CHAT_ID);
    expect(before.compacting).toBe(false);

    const after = reduceChatThreadState(before, { type: 'compact.started' });

    expect(after.compacting).toBe(true);
  });

  it('returns the SAME state reference when compacting is already true', () => {
    const base = createChatThreadState(CHAT_ID);
    const alreadyCompacting = reduceChatThreadState(base, { type: 'compact.started' });

    const after = reduceChatThreadState(alreadyCompacting, { type: 'compact.started' });

    expect(after).toBe(alreadyCompacting);
  });

  it('does not disturb other state slices', () => {
    const before = createChatThreadState(CHAT_ID);
    const after = reduceChatThreadState(before, { type: 'compact.started' });

    expect(after.runState).toEqual({ type: 'idle' });
    expect(after.contextUsage).toBeNull();
    expect(after.interactions).toBe(before.interactions);
  });
});

// ---------------------------------------------------------------------------
// compact.done
// ---------------------------------------------------------------------------

describe('reduceChatThreadState — compact.done', () => {
  it('sets compacting to false when it was true', () => {
    const base = createChatThreadState(CHAT_ID);
    const compacting = reduceChatThreadState(base, { type: 'compact.started' });
    expect(compacting.compacting).toBe(true);

    const after = reduceChatThreadState(compacting, { type: 'compact.done' });

    expect(after.compacting).toBe(false);
  });

  it('returns the SAME state reference when compacting is already false', () => {
    const before = createChatThreadState(CHAT_ID);
    expect(before.compacting).toBe(false);

    const after = reduceChatThreadState(before, { type: 'compact.done' });

    expect(after).toBe(before);
  });

  it('does not disturb other state slices', () => {
    const base = createChatThreadState(CHAT_ID);
    const compacting = reduceChatThreadState(base, { type: 'compact.started' });
    const after = reduceChatThreadState(compacting, { type: 'compact.done' });

    expect(after.runState).toEqual({ type: 'idle' });
    expect(after.contextUsage).toBeNull();
    expect(after.interactions).toBe(compacting.interactions);
  });
});
