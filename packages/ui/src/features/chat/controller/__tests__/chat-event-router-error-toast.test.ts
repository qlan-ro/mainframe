/**
 * Behavior tests: routeDaemonEvent raises an mfToast on a daemon `error` event
 * targeting this chat (the still-live branch in chat-event-router.ts).
 *
 * Recovered from the deleted chat-thread-controller-cancel-failed.test.ts
 * (commit fd185431's "daemon error toast" describe block), which was removed
 * along with the cancel_failed toast tests it shared a file with — that
 * removal dropped coverage for an unrelated, still-live branch. Re-homed here
 * as its own file so it survives independently of the cancel_failed cleanup.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DaemonEvent } from '@qlan-ro/mainframe-types';
import type { DaemonWsClient } from '../../../../lib/daemon/ws-client';

// ---------------------------------------------------------------------------
// Mocks (hoisted)
// ---------------------------------------------------------------------------

vi.mock('@/lib/toast', () => ({
  mfToast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

vi.mock('../../../../lib/api/attachments', () => ({
  uploadAttachments: vi.fn(),
}));

vi.mock('../../../../lib/api/chats', () => ({
  getChatMessages: vi.fn().mockResolvedValue({ messages: [], transcriptMissing: false }),
  getPendingPermission: vi.fn().mockResolvedValue(null),
  resumeChat: vi.fn().mockResolvedValue(undefined),
  interruptChat: vi.fn().mockResolvedValue(undefined),
  cancelQueuedMessage: vi.fn().mockResolvedValue(undefined),
  editQueuedMessage: vi.fn().mockResolvedValue(undefined),
}));

import { mfToast } from '@/lib/toast';
import { ChatThreadController } from '../chat-thread-controller';

// ---------------------------------------------------------------------------
// Fake WS client with captured onEvent handler (same harness as the other
// chat-event-router toast tests)
// ---------------------------------------------------------------------------

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

const CHAT_ID = 'chat-error-toast';
const PORT = 9999;

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('daemon error toast', () => {
  it('surfaces a daemon run error targeting this chat via mfToast.error', () => {
    const { fakeClient, pushEvent } = makeFakeWs();
    const ctrl = new ChatThreadController(CHAT_ID, PORT, fakeClient);
    ctrl.subscribeLive();

    pushEvent({ type: 'error', chatId: CHAT_ID, error: 'the CLI process failed to start' } as unknown as DaemonEvent);

    expect(vi.mocked(mfToast.error)).toHaveBeenCalledOnce();
    expect(vi.mocked(mfToast.error).mock.calls[0]![0]).toBe('Agent run failed');
    expect(vi.mocked(mfToast.error).mock.calls[0]![1]).toEqual({ description: 'the CLI process failed to start' });
  });

  it('does NOT toast for an error targeting a different chat', () => {
    const { fakeClient, pushEvent } = makeFakeWs();
    const ctrl = new ChatThreadController(CHAT_ID, PORT, fakeClient);
    ctrl.subscribeLive();

    pushEvent({ type: 'error', chatId: 'other-chat', error: 'boom' } as unknown as DaemonEvent);

    expect(vi.mocked(mfToast.error)).not.toHaveBeenCalled();
  });
});
