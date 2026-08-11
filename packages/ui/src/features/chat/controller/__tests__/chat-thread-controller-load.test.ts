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
import type { DisplayMessage } from '@qlan-ro/mainframe-types';
import type { DaemonEvent } from '@qlan-ro/mainframe-types';

// ---------------------------------------------------------------------------
// Mocks — hoisted by vitest, must appear before the import under test.
// ---------------------------------------------------------------------------

vi.mock('../../../../lib/api/attachments', () => ({
  uploadAttachments: vi.fn(),
}));

vi.mock('../../../../lib/api/chats', () => ({
  getChatMessages: vi.fn().mockResolvedValue({ messages: [], transcriptMissing: false, workflowRuns: [] }),
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
    vi.mocked(getChatMessages).mockResolvedValueOnce({ messages: [], transcriptMissing: false, workflowRuns: [] });

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
    vi.mocked(getChatMessages).mockResolvedValueOnce({ messages: [], transcriptMissing: false, workflowRuns: [] });

    const ctrl = new ChatThreadController(CHAT_ID, PORT, makeFakeWs());
    ctrl.subscribeLive();

    await ctrl.load();

    expect(ctrl.getState().loadState.type).toBe('ready');
  });
});

// ---------------------------------------------------------------------------
// 4. Seed once (#275) — a second mount must not re-seed
//
// An adopted controller is mounted twice across the first-send handoff (the
// draft item, then the canonical remote item). The daemon stores the user
// message only AFTER spawning the CLI, so the second mount's REST read can
// legitimately return an empty transcript — and history.loaded is a wholesale
// replace. Re-seeding there wipes the live transcript; refresh() forces.
// ---------------------------------------------------------------------------

describe('ChatThreadController.load — seeds once per controller', () => {
  it('does not re-fetch on a second load() after the first settled ready', async () => {
    vi.mocked(getChatMessages).mockResolvedValue({ messages: [], transcriptMissing: false, workflowRuns: [] });

    const ctrl = new ChatThreadController(CHAT_ID, PORT, makeFakeWs());
    ctrl.subscribeLive();

    await ctrl.load();
    expect(getChatMessages).toHaveBeenCalledTimes(1);

    await ctrl.load();

    expect(getChatMessages).toHaveBeenCalledTimes(1);
  });

  it('refresh() still re-fetches after a ready load', async () => {
    vi.mocked(getChatMessages).mockResolvedValue({ messages: [], transcriptMissing: false, workflowRuns: [] });

    const ctrl = new ChatThreadController(CHAT_ID, PORT, makeFakeWs());
    ctrl.subscribeLive();

    await ctrl.load();
    await ctrl.refresh();

    expect(getChatMessages).toHaveBeenCalledTimes(2);
  });

  it('retries after a failed load — an error state is not a seed', async () => {
    vi.mocked(getChatMessages).mockRejectedValueOnce(new Error('transient'));
    vi.mocked(getChatMessages).mockResolvedValueOnce({ messages: [], transcriptMissing: false, workflowRuns: [] });

    const ctrl = new ChatThreadController(CHAT_ID, PORT, makeFakeWs());
    ctrl.subscribeLive();

    await ctrl.load();
    await ctrl.load();

    expect(getChatMessages).toHaveBeenCalledTimes(2);
    expect(ctrl.getState().loadState.type).toBe('ready');
  });
});

// ---------------------------------------------------------------------------
// 4. An empty BACKGROUND re-seed must not blank a populated transcript (todo #320)
// ---------------------------------------------------------------------------

describe('ChatThreadController.refresh — an empty re-seed of a populated thread', () => {
  const message: DisplayMessage = {
    id: 'msg-1',
    chatId: CHAT_ID,
    role: 'user',
    content: 'hello',
    timestamp: new Date(0).toISOString(),
  } as unknown as DisplayMessage;

  it('keeps the transcript when a forced refresh comes back empty', async () => {
    vi.mocked(getChatMessages).mockResolvedValueOnce({
      messages: [message],
      transcriptMissing: false,
      workflowRuns: [],
    });
    vi.mocked(getChatMessages).mockResolvedValueOnce({ messages: [], transcriptMissing: false, workflowRuns: [] });

    const ctrl = new ChatThreadController(CHAT_ID, PORT, makeFakeWs());
    ctrl.subscribeLive();

    await ctrl.load();
    expect(ctrl.getState().messageOrder).toEqual(['msg-1']);

    await ctrl.refresh();

    // The daemon returning [] means "I have nothing for you" (it has no history
    // session for this chat yet), not "this thread is empty".
    expect(ctrl.getState().messageOrder).toEqual(['msg-1']);
  });

  it('settles loadState back to ready after refusing the empty re-seed', async () => {
    vi.mocked(getChatMessages).mockResolvedValueOnce({
      messages: [message],
      transcriptMissing: false,
      workflowRuns: [],
    });
    vi.mocked(getChatMessages).mockResolvedValueOnce({ messages: [], transcriptMissing: false, workflowRuns: [] });

    const ctrl = new ChatThreadController(CHAT_ID, PORT, makeFakeWs());
    ctrl.subscribeLive();

    await ctrl.load();
    await ctrl.refresh();

    // Refusing must not strand the thread on a spinner.
    expect(ctrl.getState().loadState.type).toBe('ready');
  });

  it('still renders a genuinely empty thread — the FIRST load is never refused', async () => {
    vi.mocked(getChatMessages).mockResolvedValue({ messages: [], transcriptMissing: false, workflowRuns: [] });

    const ctrl = new ChatThreadController(CHAT_ID, PORT, makeFakeWs());
    ctrl.subscribeLive();

    await ctrl.load();

    expect(ctrl.getState().messageOrder).toEqual([]);
    expect(ctrl.getState().loadState.type).toBe('ready');
  });
});
