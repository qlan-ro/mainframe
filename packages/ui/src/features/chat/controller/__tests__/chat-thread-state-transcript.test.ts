/**
 * chat-thread-state — transcriptMissing plumbing.
 *
 * `history.loaded` carries the typed daemon payload's transcriptMissing flag;
 * the reducer mirrors it into chatConfig (when seeded) so the degraded card
 * reacts to a load-time detection without waiting for a chat.updated. A
 * chat.updated differing ONLY in transcriptMissing must also refresh
 * chatConfig (sameComposerConfig must not swallow it).
 */
import { describe, it, expect } from 'vitest';
import type { Chat } from '@qlan-ro/mainframe-types';
import { createChatThreadState, reduceChatThreadState } from '../chat-thread-state';

const chatFixture = {
  id: 'c1',
  adapterId: 'claude',
  projectId: 'p1',
  status: 'active',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  totalCost: 0,
  totalTokensInput: 0,
  totalTokensOutput: 0,
  lastContextTokensInput: 0,
  transcriptMissing: false,
} as Chat;

describe('history.loaded — transcriptMissing mirror', () => {
  it('sets chatConfig.transcriptMissing when chatConfig is seeded', () => {
    let state = createChatThreadState('c1');
    state = reduceChatThreadState(state, { type: 'chat.config.updated', chat: chatFixture });

    state = reduceChatThreadState(state, { type: 'history.loaded', messages: [], transcriptMissing: true });

    expect(state.loadState).toEqual({ type: 'ready' });
    expect(state.chatConfig?.transcriptMissing).toBe(true);
  });

  it('leaves a null chatConfig alone (REST seed carries the flag later)', () => {
    let state = createChatThreadState('c1');
    state = reduceChatThreadState(state, { type: 'history.loaded', messages: [], transcriptMissing: true });
    expect(state.chatConfig).toBeNull();
  });

  it('clears a previously-set flag when the payload reports the transcript back', () => {
    let state = createChatThreadState('c1');
    state = reduceChatThreadState(state, {
      type: 'chat.config.updated',
      chat: { ...chatFixture, transcriptMissing: true },
    });

    state = reduceChatThreadState(state, { type: 'history.loaded', messages: [], transcriptMissing: false });

    expect(state.chatConfig?.transcriptMissing).toBe(false);
  });
});

describe('chat.config.updated — transcriptMissing is composer-relevant', () => {
  it('adopts a chat.updated that differs only in transcriptMissing', () => {
    let state = createChatThreadState('c1');
    state = reduceChatThreadState(state, { type: 'chat.config.updated', chat: chatFixture });

    state = reduceChatThreadState(state, {
      type: 'chat.config.updated',
      chat: { ...chatFixture, transcriptMissing: true },
    });

    expect(state.chatConfig?.transcriptMissing).toBe(true);
  });
});
