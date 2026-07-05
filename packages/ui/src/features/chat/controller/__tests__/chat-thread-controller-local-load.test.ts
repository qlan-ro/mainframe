/**
 * Behavior tests for ChatThreadController.load() on a __LOCALID_* thread (HIGH-2).
 *
 * A brand-new local thread has no daemon chat yet, so load() must NOT hit the
 * REST endpoints with the synthetic __LOCALID_* id (that 404s and reduces
 * loadState to 'error', surfacing the load-error banner on an empty new-thread
 * surface). Covered:
 *  1. load() on a __LOCALID_* controller calls neither getChat nor getChatMessages
 *     and leaves loadState 'idle' (not 'loading'/'error').
 *  2. After setRemoteId adopts a real id, the initial history load runs against
 *     that real id (getChatMessages called with the remote id, never the local one).
 *
 * Mirrors the fake-ws + REST-mock pattern of the sibling controller tests.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DaemonEvent } from '@qlan-ro/mainframe-types';
import type { DaemonWsClient } from '../../../../lib/daemon/ws-client';

// ---------------------------------------------------------------------------
// Mocks — hoisted by vitest, before the import under test.
// ---------------------------------------------------------------------------

vi.mock('../../../../lib/api/attachments', () => ({
  uploadAttachments: vi.fn(),
}));

vi.mock('../../../../lib/api/chats', () => ({
  getChatMessages: vi.fn().mockResolvedValue([]),
  getChat: vi.fn().mockResolvedValue(null),
  getPendingPermission: vi.fn().mockResolvedValue(null),
  resumeChat: vi.fn().mockResolvedValue(undefined),
  interruptChat: vi.fn().mockResolvedValue(undefined),
  cancelQueuedMessage: vi.fn().mockResolvedValue(undefined),
  editQueuedMessage: vi.fn().mockResolvedValue(undefined),
}));

import { getChat, getChatMessages } from '../../../../lib/api/chats';
import { ChatThreadController } from '../chat-thread-controller';

// ---------------------------------------------------------------------------
// Minimal fake WS — no sends needed for the load-gating assertions.
// ---------------------------------------------------------------------------

function makeFakeWs(): DaemonWsClient {
  return {
    get connected() {
      return false;
    },
    send: () => {},
    onEvent(_handler: (event: DaemonEvent) => void) {
      return () => {};
    },
    subscribe: () => {},
    unsubscribe: () => {},
    subscribeConnection: () => () => {},
    setPort: () => {},
    connect: () => {},
    disconnect: () => {},
  } as unknown as DaemonWsClient;
}

const LOCAL_ID = '__LOCALID_abc';
const REMOTE_ID = 'chat-real-1';
const PORT = 9999;

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// 1. load() on a local thread is a no-op against the network
// ---------------------------------------------------------------------------

describe('ChatThreadController.load — __LOCALID_* thread', () => {
  it('does not call getChat or getChatMessages on mount-load', async () => {
    const ctrl = new ChatThreadController(LOCAL_ID, PORT, makeFakeWs());

    await ctrl.load();
    await flushMicrotasks();

    expect(getChat).not.toHaveBeenCalled();
    expect(getChatMessages).not.toHaveBeenCalled();
  });

  it('leaves loadState "idle" (never "loading" or "error") for a local thread', async () => {
    const ctrl = new ChatThreadController(LOCAL_ID, PORT, makeFakeWs());

    await ctrl.load();
    await flushMicrotasks();

    expect(ctrl.getState().loadState.type).toBe('idle');
  });
});

// ---------------------------------------------------------------------------
// 2. After setRemoteId the initial load runs against the real id
// ---------------------------------------------------------------------------

describe('ChatThreadController.setRemoteId — triggers the initial load', () => {
  it('loads history against the real id after adopting it (never the local id)', async () => {
    const ctrl = new ChatThreadController(LOCAL_ID, PORT, makeFakeWs());

    ctrl.setRemoteId(REMOTE_ID);
    await flushMicrotasks();

    const messageCalls = vi.mocked(getChatMessages).mock.calls;
    expect(messageCalls.some((args) => args[1] === REMOTE_ID)).toBe(true);
    expect(messageCalls.some((args) => args[1] === LOCAL_ID)).toBe(false);
  });

  it('settles loadState to "ready" after the real-id load resolves', async () => {
    const ctrl = new ChatThreadController(LOCAL_ID, PORT, makeFakeWs());

    ctrl.setRemoteId(REMOTE_ID);
    await flushMicrotasks();

    expect(ctrl.getState().loadState.type).toBe('ready');
  });

  // Regression: state.chatId (the public snapshot read by every extras.state.chatId
  // consumer — composer tuning, the diff-expand fetch, the @-file search scope) must
  // flip to the daemon id too, not just the controller's private daemonId field.
  it('flips state.chatId to the real id synchronously, before the load resolves', () => {
    const ctrl = new ChatThreadController(LOCAL_ID, PORT, makeFakeWs());

    ctrl.setRemoteId(REMOTE_ID);

    expect(ctrl.getState().chatId).toBe(REMOTE_ID);
  });
});
