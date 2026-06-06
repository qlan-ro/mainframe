/**
 * Behavior tests: routeDaemonEvent raises a toast on message.queued.cancel_failed.
 *
 * The reducer no-ops cancel_failed (state is preserved), so the toast.error call
 * is the only user-visible signal. These tests pin that signal:
 *   1. A matching chatId fires toast.error exactly once with the correct message.
 *   2. A different chatId does NOT fire toast.error.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DaemonEvent } from '@qlan-ro/mainframe-types';
import type { DaemonWsClient } from '../../../../lib/daemon/ws-client';

// ---------------------------------------------------------------------------
// Mocks (hoisted)
// ---------------------------------------------------------------------------

vi.mock('sonner', () => ({
  toast: { error: vi.fn() },
}));

vi.mock('../../../../lib/api/attachments', () => ({
  uploadAttachments: vi.fn(),
}));

vi.mock('../../../../lib/api/chats', () => ({
  getChatMessages: vi.fn().mockResolvedValue([]),
  getPendingPermission: vi.fn().mockResolvedValue(null),
  resumeChat: vi.fn().mockResolvedValue(undefined),
  interruptChat: vi.fn().mockResolvedValue(undefined),
  cancelQueuedMessage: vi.fn().mockResolvedValue(undefined),
  editQueuedMessage: vi.fn().mockResolvedValue(undefined),
}));

import { toast } from 'sonner';
import { ChatThreadController } from '../chat-thread-controller';

// ---------------------------------------------------------------------------
// Fake WS client with captured onEvent handler (same harness as ack tests)
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

const CHAT_ID = 'chat-cancel-failed';
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

describe('message.queued.cancel_failed toast', () => {
  it('fires toast.error once with the correct message when chatId matches', () => {
    const { fakeClient, pushEvent } = makeFakeWs();
    const ctrl = new ChatThreadController(CHAT_ID, PORT, fakeClient);
    ctrl.subscribe(() => {});

    pushEvent({ type: 'message.queued.cancel_failed', chatId: CHAT_ID, uuid: 'u1' });

    expect(vi.mocked(toast.error)).toHaveBeenCalledOnce();
    expect(vi.mocked(toast.error).mock.calls[0]![0]).toBe("Couldn't cancel the queued message");
  });

  it('does NOT fire toast.error when the event is for a different chat', () => {
    const { fakeClient, pushEvent } = makeFakeWs();
    const ctrl = new ChatThreadController(CHAT_ID, PORT, fakeClient);
    ctrl.subscribe(() => {});

    pushEvent({ type: 'message.queued.cancel_failed', chatId: 'other-chat', uuid: 'u2' });

    expect(vi.mocked(toast.error)).not.toHaveBeenCalled();
  });
});
