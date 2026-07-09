/**
 * Behavior tests for ChatThreadController.load() — history-load-failure path.
 *
 * Covers:
 *  1. getChatMessages rejects → loadState transitions to { type: 'error' } with
 *     the rejected Error captured on .error.
 *  2. After a failure, refresh() (→ load(true)) resolves → loadState recovers
 *     to { type: 'ready' }. This is the code path driven by the "Retry" banner.
 *  3. Happy-path sanity: getChatMessages resolves [] → loadState is 'ready'.
 *
 * Strategy
 * --------
 * Reuses the same fake DaemonWsClient and vi.mock block as the ack/send tests.
 * getChatMessages is vi.mocked per-test via mockRejectedValueOnce /
 * mockResolvedValueOnce. We await load() / refresh() fully so the .catch /
 * .then continuation (where dispatch happens) settles before asserting.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DaemonWsClient } from '../../../../lib/daemon/ws-client';
import type { DaemonEvent } from '@qlan-ro/mainframe-types';

// ---------------------------------------------------------------------------
// Mocks — hoisted by vitest, must appear before the import under test.
// ---------------------------------------------------------------------------

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

import { getChatMessages } from '../../../../lib/api/chats';
import { ChatThreadController } from '../chat-thread-controller';

// ---------------------------------------------------------------------------
// Fake WS client — minimal surface, no recorded sends needed here.
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

const CHAT_ID = 'chat-load-test';
const PORT = 9999;

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// 1. Load failure — loadState becomes { type: 'error', error: <the Error> }
// ---------------------------------------------------------------------------

describe('ChatThreadController.load — getChatMessages rejects', () => {
  it('sets loadState.type to "error" when getChatMessages rejects', async () => {
    vi.mocked(getChatMessages).mockRejectedValueOnce(new Error('boom'));

    const ctrl = new ChatThreadController(CHAT_ID, PORT, makeFakeWs());
    ctrl.subscribeLive();

    await ctrl.load();

    expect(ctrl.getState().loadState.type).toBe('error');
  });

  it('captures the rejected Error on loadState.error', async () => {
    const boom = new Error('boom');
    vi.mocked(getChatMessages).mockRejectedValueOnce(boom);

    const ctrl = new ChatThreadController(CHAT_ID, PORT, makeFakeWs());
    ctrl.subscribeLive();

    await ctrl.load();

    const loadState = ctrl.getState().loadState;
    // Narrow via cast — noUncheckedIndexedAccess is on, so we need the cast to
    // access .error without the compiler complaining about the union type.
    const error = (loadState as { type: string; error?: unknown }).error;
    expect(error).toBe(boom);
    expect((error as Error).message).toBe('boom');
  });
});

// ---------------------------------------------------------------------------
// 2. Retry recovers — refresh() after failure → loadState becomes 'ready'
// ---------------------------------------------------------------------------

describe('ChatThreadController.refresh — recovers from a prior failure', () => {
  it('transitions loadState back to "ready" when refresh resolves after a failure', async () => {
    // First call rejects (the failure).
    vi.mocked(getChatMessages).mockRejectedValueOnce(new Error('transient'));
    // Second call (refresh) resolves with an empty history.
    vi.mocked(getChatMessages).mockResolvedValueOnce({ messages: [], transcriptMissing: false });

    const ctrl = new ChatThreadController(CHAT_ID, PORT, makeFakeWs());
    ctrl.subscribeLive();

    await ctrl.load();
    expect(ctrl.getState().loadState.type).toBe('error');

    // refresh() calls load(true) to bypass the dedup guard.
    await ctrl.refresh();

    expect(ctrl.getState().loadState.type).toBe('ready');
  });
});

// ---------------------------------------------------------------------------
// 3. Happy-path sanity — resolving [] → loadState is 'ready'
// ---------------------------------------------------------------------------

describe('ChatThreadController.load — getChatMessages resolves', () => {
  it('sets loadState.type to "ready" when getChatMessages resolves with an empty array', async () => {
    vi.mocked(getChatMessages).mockResolvedValueOnce({ messages: [], transcriptMissing: false });

    const ctrl = new ChatThreadController(CHAT_ID, PORT, makeFakeWs());
    ctrl.subscribeLive();

    await ctrl.load();

    expect(ctrl.getState().loadState.type).toBe('ready');
  });
});
