/**
 * Behavior tests: routeDaemonEvent raises a persistent permission toast on
 * chat.trustRequired (NOT an error toast, and no run-failure state event) —
 * the untrusted-workspace advisory is non-fatal. The toast's Trust action
 * calls trustWorkspace(0, chatId).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DaemonEvent } from '@qlan-ro/mainframe-types';
import type { DaemonWsClient } from '../../../../lib/daemon/ws-client';

// ---------------------------------------------------------------------------
// Mocks (hoisted)
// ---------------------------------------------------------------------------

vi.mock('@/lib/toast', () => ({
  mfToast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn(), permission: vi.fn() },
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
  trustWorkspace: vi.fn().mockResolvedValue(undefined),
}));

import { mfToast } from '@/lib/toast';
import { trustWorkspace } from '../../../../lib/api/chats';
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

const CHAT_ID = 'chat-trust-required';
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

describe('chat.trustRequired toast', () => {
  it('fires mfToast.permission (not mfToast.error) when chatId matches', () => {
    const { fakeClient, pushEvent } = makeFakeWs();
    const ctrl = new ChatThreadController(CHAT_ID, PORT, fakeClient);
    ctrl.subscribeLive();

    pushEvent({ type: 'chat.trustRequired', chatId: CHAT_ID, projectPath: '/p' });

    expect(vi.mocked(mfToast.permission)).toHaveBeenCalledOnce();
    expect(vi.mocked(mfToast.error)).not.toHaveBeenCalled();
  });

  it('does NOT fire mfToast.permission for a different chat', () => {
    const { fakeClient, pushEvent } = makeFakeWs();
    const ctrl = new ChatThreadController(CHAT_ID, PORT, fakeClient);
    ctrl.subscribeLive();

    pushEvent({ type: 'chat.trustRequired', chatId: 'other-chat', projectPath: '/p' });

    expect(vi.mocked(mfToast.permission)).not.toHaveBeenCalled();
  });

  it('does not dispatch a run-failure state change (run state is untouched)', () => {
    const { fakeClient, pushEvent } = makeFakeWs();
    const ctrl = new ChatThreadController(CHAT_ID, PORT, fakeClient);
    ctrl.subscribeLive();

    const before = ctrl.getState().runState;
    pushEvent({ type: 'chat.trustRequired', chatId: CHAT_ID, projectPath: '/p' });
    const after = ctrl.getState().runState;

    expect(after).toBe(before);
  });

  it('clicking the toast action invokes trustWorkspace(0, chatId)', () => {
    const { fakeClient, pushEvent } = makeFakeWs();
    const ctrl = new ChatThreadController(CHAT_ID, PORT, fakeClient);
    ctrl.subscribeLive();

    pushEvent({ type: 'chat.trustRequired', chatId: CHAT_ID, projectPath: '/p' });

    const call = vi.mocked(mfToast.permission).mock.calls[0]!;
    const opts = call[1] as { action?: { onClick: () => void } };
    opts.action?.onClick();

    expect(vi.mocked(trustWorkspace)).toHaveBeenCalledWith(0, CHAT_ID);
  });
});
