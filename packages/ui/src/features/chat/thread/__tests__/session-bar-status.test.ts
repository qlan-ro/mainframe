/**
 * Behavior tests for `deriveContextPct` (session-bar-status.ts).
 *
 * All expected values are hardcoded. No derivation logic is re-computed here.
 * Fixtures are built via `createChatThreadState` + spreads; chatConfig fields
 * are cast the same way the config tests do (`as unknown as Chat`).
 */
import { describe, it, expect } from 'vitest';
import type { Chat } from '@qlan-ro/mainframe-types';
import { createChatThreadState, reduceChatThreadState } from '../../controller/chat-thread-state';
import type { ChatThreadState } from '../../controller/chat-thread-state';
import { deriveContextPct } from '../session-bar-status';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal Chat fixture used for chatConfig; only the fields the derivations read. */
function makeChat(overrides: Partial<Chat> = {}): Chat {
  return {
    id: 'c1',
    adapterId: 'claude',
    worktreeMissing: false,
    lastContextTokensInput: 0,
    ...overrides,
  } as unknown as Chat;
}

/** Base idle state with chatConfig populated (so worktreeMissing is accessible). */
function idleState(): ChatThreadState {
  const base = createChatThreadState('c1');
  return reduceChatThreadState(base, { type: 'chat.config.updated', chat: makeChat() });
}

/** Set contextUsage on a state. */
function withContextUsage(
  state: ChatThreadState,
  percentage: number,
  totalTokens = 0,
  maxTokens = 200_000,
): ChatThreadState {
  return reduceChatThreadState(state, { type: 'context.usage', percentage, totalTokens, maxTokens });
}

// ---------------------------------------------------------------------------
// deriveContextPct — CLI-reported usage
// ---------------------------------------------------------------------------

describe('deriveContextPct — CLI-reported contextUsage wins', () => {
  it('returns the CLI percentage (rounded) when contextUsage is present', () => {
    const state = withContextUsage(idleState(), 38);
    expect(deriveContextPct(state, 200_000)).toBe(38);
  });

  it('rounds a fractional CLI percentage to the nearest integer', () => {
    const state = withContextUsage(idleState(), 37.6);
    expect(deriveContextPct(state, 200_000)).toBe(38);
  });

  it('caps CLI percentage at 100 even when the daemon reports > 100', () => {
    const state = withContextUsage(idleState(), 110);
    expect(deriveContextPct(state, 200_000)).toBe(100);
  });

  it('uses CLI percentage even when a token-based fallback would give a different value', () => {
    // chatConfig.lastContextTokensInput = 10_000, window = 200_000 → fallback would be 5.
    // CLI reports 38 → 38 wins.
    const stateWithTokens = reduceChatThreadState(idleState(), {
      type: 'chat.config.updated',
      chat: makeChat({ lastContextTokensInput: 10_000 }),
    });
    const state = withContextUsage(stateWithTokens, 38);
    expect(deriveContextPct(state, 200_000)).toBe(38);
  });
});

// ---------------------------------------------------------------------------
// deriveContextPct — token-based fallback
// ---------------------------------------------------------------------------

describe('deriveContextPct — token-based fallback', () => {
  it('returns 25 for 50_000 tokens in a 200_000-token window', () => {
    const state = reduceChatThreadState(createChatThreadState('c1'), {
      type: 'chat.config.updated',
      chat: makeChat({ lastContextTokensInput: 50_000 }),
    });
    expect(deriveContextPct(state, 200_000)).toBe(25);
  });

  it('returns 50 for 100_000 tokens in a 200_000-token window', () => {
    const state = reduceChatThreadState(createChatThreadState('c1'), {
      type: 'chat.config.updated',
      chat: makeChat({ lastContextTokensInput: 100_000 }),
    });
    expect(deriveContextPct(state, 200_000)).toBe(50);
  });

  it('caps the fallback at 100 when tokens exceed the window', () => {
    const state = reduceChatThreadState(createChatThreadState('c1'), {
      type: 'chat.config.updated',
      chat: makeChat({ lastContextTokensInput: 250_000 }),
    });
    expect(deriveContextPct(state, 200_000)).toBe(100);
  });

  it('rounds the fallback percentage', () => {
    // 1 / 3 * 100 = 33.33… → rounds to 33
    const state = reduceChatThreadState(createChatThreadState('c1'), {
      type: 'chat.config.updated',
      chat: makeChat({ lastContextTokensInput: 1 }),
    });
    expect(deriveContextPct(state, 3)).toBe(33);
  });
});

// ---------------------------------------------------------------------------
// deriveContextPct — persisted CLI truth beats the catalog guess (#197)
// ---------------------------------------------------------------------------

describe('deriveContextPct — persisted CLI totals (via chat.config.updated)', () => {
  it('uses persistedTotal/persistedMax, not lastContextTokensInput/catalog window', () => {
    // The stuck-at-100% bug: 151k real tokens, catalog window wrongly 200k
    // (real claude-sonnet-5 window is ~967k usable). The persisted CLI totals
    // must win: 151_000 / 967_000 ≈ 16%, not min(100, 151/200) = 76%.
    const state = reduceChatThreadState(createChatThreadState('c1'), {
      type: 'chat.config.updated',
      chat: makeChat({
        lastContextTokensInput: 151_000,
        lastContextTotalTokens: 151_000,
        lastContextMaxTokens: 967_000,
      }),
    });
    expect(deriveContextPct(state, 200_000)).toBe(16);
  });

  it('still falls back to the catalog estimate when the chat has no persisted totals', () => {
    const state = reduceChatThreadState(createChatThreadState('c1'), {
      type: 'chat.config.updated',
      chat: makeChat({ lastContextTokensInput: 50_000 }),
    });
    expect(deriveContextPct(state, 200_000)).toBe(25);
  });
});

// ---------------------------------------------------------------------------
// deriveContextPct — null when no data
// ---------------------------------------------------------------------------

describe('deriveContextPct — returns null when no usable data', () => {
  it('returns null when contextUsage is null and contextWindow is undefined', () => {
    expect(deriveContextPct(idleState(), undefined)).toBeNull();
  });

  it('returns null when contextUsage is null and contextWindow is 0', () => {
    expect(deriveContextPct(idleState(), 0)).toBeNull();
  });

  it('returns null when contextUsage is null and contextWindow is negative', () => {
    expect(deriveContextPct(idleState(), -1)).toBeNull();
  });

  it('returns null when contextUsage is null and chatConfig has 0 tokens with no window', () => {
    const state = createChatThreadState('c1');
    expect(deriveContextPct(state, undefined)).toBeNull();
  });
});
