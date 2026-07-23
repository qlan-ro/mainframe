/**
 * session-list-router — behavior tests (TDD red phase).
 *
 * Behaviors covered:
 *  - chat.created  → onReload called once; onMarkUnread not called
 *  - chat.ended    → onReload called once; onMarkUnread not called
 *  - chat.updated  → onReload called once; waiting/completed/error also mark unread
 *  - chat.notification → onMarkUnread called with the chatId; onReload not called
 *  - permission.requested (notify: true)  → onMarkUnread called with chatId; onReload not called
 *  - permission.requested (notify: false) → onMarkUnread called with chatId
 *  - permission.resolved  → neither mock called
 *  - background_task.started|updated|ended → onReload called; onMarkUnread not called
 *  - dispose() unsubscribes; subsequent dispatched events are ignored
 *  - Unrelated event type (display.message.added) → no-op
 *
 * All tests run against the plain SessionListRouter class — no React, no
 * zustand. A fake DaemonWsClient injects the event handler; deps are vi.fn()
 * mocks so assertions are trivial.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { BackgroundTask, Chat, DaemonEvent } from '@qlan-ro/mainframe-types';
import type { DaemonWsClient } from '../../../../lib/daemon/ws-client';
import { SessionListRouter } from '../session-list-router';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Minimal Chat with required fields only — optional fields omitted. */
const MINIMAL_CHAT: Chat = {
  id: 'c1',
  adapterId: 'claude',
  projectId: 'p1',
  status: 'active',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
  totalCost: 0,
  totalTokensInput: 0,
  totalTokensOutput: 0,
  lastContextTokensInput: 0,
};

/** Full Chat used by the chat.updated test per plan § 7.1. */
const FULL_CHAT: Chat = {
  id: 'c2',
  adapterId: 'claude',
  projectId: 'p1',
  title: 'My Chat',
  status: 'active',
  displayStatus: 'working',
  pinned: false,
  tags: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
  totalCost: 0,
  totalTokensInput: 0,
  totalTokensOutput: 0,
  lastContextTokensInput: 0,
  detectedPrs: [],
};

// ---------------------------------------------------------------------------
// Fake WS client
// ---------------------------------------------------------------------------

type EventHandler = (event: DaemonEvent) => void;

function makeFakeWs(): {
  ws: Pick<DaemonWsClient, 'onEvent'>;
  dispatch: (event: DaemonEvent) => void;
  unsubscribeSpy: ReturnType<typeof vi.fn>;
} {
  let captured: EventHandler | null = null;
  const unsubscribeSpy = vi.fn();

  const ws = {
    onEvent(handler: EventHandler): () => void {
      captured = handler;
      return unsubscribeSpy;
    },
  };

  const dispatch = (event: DaemonEvent): void => {
    if (captured) captured(event);
  };

  return { ws, dispatch, unsubscribeSpy };
}

// ---------------------------------------------------------------------------
// Shared setup
// ---------------------------------------------------------------------------

let onReload: ReturnType<typeof vi.fn<() => void>>;
let onMarkUnread: ReturnType<typeof vi.fn<(chatId: string) => void>>;
let dispatch: (event: DaemonEvent) => void;
let unsubscribeSpy: ReturnType<typeof vi.fn>;
let router: SessionListRouter;

beforeEach(() => {
  onReload = vi.fn<() => void>();
  onMarkUnread = vi.fn<(chatId: string) => void>();
  const fakeWs = makeFakeWs();
  dispatch = fakeWs.dispatch;
  unsubscribeSpy = fakeWs.unsubscribeSpy;
  router = new SessionListRouter(fakeWs.ws as unknown as DaemonWsClient, { onReload, onMarkUnread });
});

// ---------------------------------------------------------------------------
// chat.created → reload
// ---------------------------------------------------------------------------

describe('session-list-router — chat.created triggers reload', () => {
  it('calls onReload exactly once and does not call onMarkUnread', () => {
    dispatch({ type: 'chat.created', chat: MINIMAL_CHAT });

    expect(onReload).toHaveBeenCalledTimes(1);
    expect(onMarkUnread).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// chat.ended → reload (archive signal)
// ---------------------------------------------------------------------------

describe('session-list-router — chat.ended triggers reload', () => {
  it('calls onReload exactly once and does not call onMarkUnread', () => {
    dispatch({ type: 'chat.ended', chatId: 'c1' });

    expect(onReload).toHaveBeenCalledTimes(1);
    expect(onMarkUnread).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// chat.updated → reload (NOT a surgical patch — see plan Phase 7 D6 deviation)
// ---------------------------------------------------------------------------

describe('session-list-router — chat.updated triggers reload', () => {
  it('calls onReload exactly once and does not call onMarkUnread', () => {
    dispatch({ type: 'chat.updated', chat: FULL_CHAT });

    expect(onReload).toHaveBeenCalledTimes(1);
    expect(onMarkUnread).not.toHaveBeenCalled();
  });

  it('marks unread when chat.updated carries a waiting display status', () => {
    dispatch({ type: 'chat.updated', chat: { ...FULL_CHAT, displayStatus: 'waiting' } });

    expect(onReload).toHaveBeenCalledTimes(1);
    expect(onMarkUnread).toHaveBeenCalledTimes(1);
    expect(onMarkUnread).toHaveBeenCalledWith('c2');
  });

  it('marks unread when chat.updated carries a completed terminal reason', () => {
    dispatch({ type: 'chat.updated', chat: { ...FULL_CHAT, displayStatus: 'idle' }, reason: 'completed' });

    expect(onReload).toHaveBeenCalledTimes(1);
    expect(onMarkUnread).toHaveBeenCalledTimes(1);
    expect(onMarkUnread).toHaveBeenCalledWith('c2');
  });

  it('marks unread when chat.updated carries an error terminal reason', () => {
    dispatch({ type: 'chat.updated', chat: { ...FULL_CHAT, displayStatus: 'idle' }, reason: 'error' });

    expect(onReload).toHaveBeenCalledTimes(1);
    expect(onMarkUnread).toHaveBeenCalledTimes(1);
    expect(onMarkUnread).toHaveBeenCalledWith('c2');
  });

  it('does not mark unread when chat.updated carries an interrupted terminal reason', () => {
    dispatch({ type: 'chat.updated', chat: { ...FULL_CHAT, displayStatus: 'idle' }, reason: 'interrupted' });

    expect(onReload).toHaveBeenCalledTimes(1);
    expect(onMarkUnread).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// chat.notification → markUnread
// ---------------------------------------------------------------------------

describe('session-list-router — chat.notification triggers markUnread', () => {
  it('calls onMarkUnread with the chatId and does not call onReload', () => {
    dispatch({ type: 'chat.notification', chatId: 'c3', title: 'Done', body: 'Finished', level: 'success' });

    expect(onMarkUnread).toHaveBeenCalledTimes(1);
    expect(onMarkUnread).toHaveBeenCalledWith('c3');
    expect(onReload).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// permission.requested with notify: true → markUnread
// ---------------------------------------------------------------------------

describe('session-list-router — permission.requested (notify: true) triggers markUnread', () => {
  it('calls onMarkUnread with the chatId and does not call onReload', () => {
    dispatch({
      type: 'permission.requested',
      chatId: 'c4',
      notify: true,
      request: { requestId: 'r1', toolUseId: 't1', toolName: 'Bash', input: {}, suggestions: [] },
    });

    expect(onMarkUnread).toHaveBeenCalledTimes(1);
    expect(onMarkUnread).toHaveBeenCalledWith('c4');
    expect(onReload).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// permission.requested with notify: false → markUnread
// ---------------------------------------------------------------------------

describe('session-list-router — permission.requested (notify: false) still triggers markUnread', () => {
  it('calls onMarkUnread with the chatId and does not call onReload', () => {
    dispatch({
      type: 'permission.requested',
      chatId: 'c4',
      notify: false,
      request: { requestId: 'r1', toolUseId: 't1', toolName: 'Bash', input: {}, suggestions: [] },
    });

    expect(onMarkUnread).toHaveBeenCalledTimes(1);
    expect(onMarkUnread).toHaveBeenCalledWith('c4');
    expect(onReload).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// permission.resolved → no-op
// ---------------------------------------------------------------------------

describe('session-list-router — permission.resolved calls neither mock', () => {
  it('does not call onReload or onMarkUnread', () => {
    dispatch({ type: 'permission.resolved', chatId: 'c5', requestId: 'r1' });

    expect(onReload).not.toHaveBeenCalled();
    expect(onMarkUnread).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// background_task.started|updated|ended → reload (D1: sidebar working indicator)
// ---------------------------------------------------------------------------

const BACKGROUND_TASK: BackgroundTask = {
  id: 'bg1',
  kind: 'agent',
  toolName: 'Bash',
  toolUseId: 't1',
  command: 'run tests',
  description: 'Running tests',
  outputPath: null,
  startedAt: 0,
  endedAt: null,
  status: 'running',
  lastOutputLine: null,
  summary: null,
  usage: null,
};

describe('session-list-router — background_task lifecycle triggers reload', () => {
  it('calls onReload for started, updated, and ended without marking unread', () => {
    dispatch({ type: 'background_task.started', chatId: 'c6', task: BACKGROUND_TASK });
    dispatch({ type: 'background_task.updated', chatId: 'c6', task: BACKGROUND_TASK });
    dispatch({ type: 'background_task.ended', chatId: 'c6', task: { ...BACKGROUND_TASK, status: 'completed' } });

    expect(onReload).toHaveBeenCalledTimes(3);
    expect(onMarkUnread).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// dispose() unsubscribes
// ---------------------------------------------------------------------------

describe('session-list-router — dispose() unsubscribes the WS handler', () => {
  it('invokes the unsubscribe spy and ignores events dispatched after dispose', () => {
    router.dispose();

    expect(unsubscribeSpy).toHaveBeenCalledTimes(1);

    dispatch({ type: 'chat.created', chat: MINIMAL_CHAT });

    expect(onReload).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Unrelated event type → no-op
// ---------------------------------------------------------------------------

describe('session-list-router — unrelated event type is a no-op', () => {
  it('does not call onReload or onMarkUnread for display.message.added', () => {
    dispatch({ type: 'display.message.added' } as DaemonEvent);

    expect(onReload).not.toHaveBeenCalled();
    expect(onMarkUnread).not.toHaveBeenCalled();
  });
});
