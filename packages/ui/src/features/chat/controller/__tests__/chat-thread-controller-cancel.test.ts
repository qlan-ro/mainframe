/**
 * Behavior tests for ChatThreadController.cancel — the guard added for the
 * todo #324 QA finding (docs/qa/2026-08-14-todo-324-keyboard-shortcuts.md):
 * calling cancel() on an idle chat must not strand runState at 'cancelling'.
 * interruptChat() on an already-idle chat is a daemon no-op, so nothing ever
 * broadcasts the chat.updated that would clear it — the "Working…" indicator
 * (isRunningFromState counts 'cancelling' as running) then runs forever.
 *
 * Fake-WS-client harness matches chat-thread-controller-ack.test.ts (captures
 * the onEvent handler so a synthetic chat.updated can drive runState).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Chat, DaemonEvent } from '@qlan-ro/mainframe-types';
import type { DaemonWsClient } from '../../../../lib/daemon/ws-client';

vi.mock('../../../../lib/api/attachments', () => ({
  uploadAttachments: vi.fn(),
}));

vi.mock('../../../../lib/api/chats', () => ({
  getChatMessages: vi.fn().mockResolvedValue({ messages: [], transcriptMissing: false }),
  getChat: vi.fn().mockResolvedValue(null),
  getPendingPermission: vi.fn().mockResolvedValue(null),
  resumeChat: vi.fn().mockResolvedValue(undefined),
  interruptChat: vi.fn().mockResolvedValue(undefined),
  cancelQueuedMessage: vi.fn().mockResolvedValue(undefined),
  editQueuedMessage: vi.fn().mockResolvedValue(undefined),
}));

import { interruptChat } from '../../../../lib/api/chats';
import { ChatThreadController } from '../chat-thread-controller';

interface FakeWs {
  fakeClient: DaemonWsClient;
  pushEvent: (event: DaemonEvent) => void;
}

function makeFakeWs(): FakeWs {
  let capturedHandler: ((event: DaemonEvent) => void) | null = null;
  const fakeClient: DaemonWsClient = {
    get connected() {
      return true;
    },
    send: () => {},
    onEvent(handler: (event: DaemonEvent) => void) {
      capturedHandler = handler;
      return () => {
        capturedHandler = null;
      };
    },
    subscribe: () => {},
    unsubscribe: () => {},
    subscribeConnection: () => () => {},
    setPort: () => {},
    connect: () => {},
    disconnect: () => {},
  } as unknown as DaemonWsClient;

  function pushEvent(event: DaemonEvent): void {
    if (!capturedHandler) throw new Error('onEvent handler not yet captured');
    capturedHandler(event);
  }

  return { fakeClient, pushEvent };
}

const CHAT_ID = 'chat-abc';
const PORT = 9999;

function makeChat(overrides: Partial<Chat> = {}): Chat {
  return { id: CHAT_ID, adapterId: 'claude', projectId: 'p1', ...overrides } as Chat;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ChatThreadController.cancel — idle guard', () => {
  it('does not dispatch run.cancelling or call interruptChat when runState is idle', async () => {
    const { fakeClient } = makeFakeWs();
    const ctrl = new ChatThreadController(CHAT_ID, PORT, fakeClient);

    await ctrl.cancel();

    expect(ctrl.getState().runState).toEqual({ type: 'idle' });
    expect(interruptChat).not.toHaveBeenCalled();
  });

  it('still cancels a genuinely running chat', async () => {
    const { fakeClient, pushEvent } = makeFakeWs();
    const ctrl = new ChatThreadController(CHAT_ID, PORT, fakeClient);
    ctrl.subscribeLive();
    pushEvent({ type: 'chat.updated', chat: makeChat({ isRunning: true }) });

    await ctrl.cancel();

    expect(ctrl.getState().runState).toEqual({ type: 'cancelling' });
    expect(interruptChat).toHaveBeenCalledTimes(1);
  });
});
