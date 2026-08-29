/**
 * chat-thread-state — transcriptMissing plumbing.
 *
 * `transcriptMissing` is a `Chat` field, so `sameComposerConfig` treats it as
 * composer-relevant: a `chat.updated` differing ONLY in `transcriptMissing`
 * still refreshes `chatConfig` (the degraded-transcript card must react to
 * it). The dedicated `history.loaded`-carries-transcriptMissing mirror this
 * file used to test is retired with the event: the facade plane has no
 * history-payload frame, so on load `AcpChatController.attachPlanes()`
 * dispatches the single `chat.config.updated` from its `getChat()` REST
 * read — which already carries `transcriptMissing` — instead of a second,
 * dedicated event.
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
