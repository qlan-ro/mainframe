/**
 * Behavior tests: routeDaemonEvent mirrors chat.updated's `backgroundActivity`
 * into a background.snapshot dispatch (reconnect/turn-boundary resync path).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Chat, DaemonEvent } from '@qlan-ro/mainframe-types';
import { routeDaemonEvent, type DaemonEventRouterHost } from '../chat-event-router';
import { createChatThreadState, type ChatStateEvent } from '../chat-thread-state';

vi.mock('@/lib/toast', () => ({
  mfToast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn(), permission: vi.fn() },
}));
vi.mock('../../../../lib/api/chats', () => ({
  trustWorkspace: vi.fn(),
}));

const CHAT_ID = 'chat-abc';

function makeChat(overrides: Partial<Chat> = {}): Chat {
  return { id: CHAT_ID, adapterId: 'claude', projectId: 'p1', ...overrides } as Chat;
}

describe('routeDaemonEvent — chat.updated background resync', () => {
  let dispatched: ChatStateEvent[];
  let host: DaemonEventRouterHost;

  beforeEach(() => {
    dispatched = [];
    host = {
      getChatId: () => CHAT_ID,
      getState: () => createChatThreadState(CHAT_ID),
      dispatch: (e) => dispatched.push(e),
      refreshInBackground: vi.fn(),
    };
  });

  it('dispatches background.snapshot with the tasks from chat.backgroundActivity', () => {
    const event: DaemonEvent = {
      type: 'chat.updated',
      chat: makeChat({
        backgroundActivity: {
          total: 1,
          byKind: { agent: 1 },
          tasks: [{ id: 'a-1', kind: 'agent', description: 'reviewer', startedAt: 9000 }],
        },
      }),
    };

    routeDaemonEvent(event, host);

    expect(dispatched).toContainEqual({
      type: 'background.snapshot',
      tasks: [{ id: 'a-1', kind: 'agent', description: 'reviewer', startedAt: 9000 }],
    });
  });

  it('dispatches an empty background.snapshot when backgroundActivity is absent', () => {
    routeDaemonEvent({ type: 'chat.updated', chat: makeChat() }, host);
    expect(dispatched).toContainEqual({ type: 'background.snapshot', tasks: [] });
  });

  it('does not dispatch a snapshot for another chat', () => {
    routeDaemonEvent({ type: 'chat.updated', chat: makeChat({ id: 'chat-other' }) }, host);
    expect(dispatched.find((e) => e.type === 'background.snapshot')).toBeUndefined();
  });
});
