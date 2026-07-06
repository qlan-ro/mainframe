/**
 * Behavior tests for two post-reconnect fixes:
 *
 * 1. Restore pending permission on subscribe:ack
 *    After a subscribe:ack event the controller calls restorePendingPermission(),
 *    which fetches getPendingPermission() and dispatches permission.requested when
 *    the result is non-null — seeding state.interactions.permissions.
 *
 * 2. Reconcile optimistic pending against re-seeded history
 *    load(true) (= refresh()) fetches history and reconciles any optimistic
 *    pending whose text matches a user message in the returned history, removing
 *    it from state.pendingUserMessages to prevent duplicates after reconnect.
 *
 * Setup mirrors chat-thread-controller-ack.test.ts exactly:
 *  - Same vi.mock blocks for lib/api/chats and lib/api/attachments
 *  - Same fake DaemonWsClient with captured onEvent handler
 *  - Per-test return values via vi.mocked(...)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AppendMessage } from '@assistant-ui/react';
import type { DaemonEvent, DisplayMessage } from '@qlan-ro/mainframe-types';
import type { DaemonWsClient } from '../../../../lib/daemon/ws-client';

// ---------------------------------------------------------------------------
// Mocks (hoisted)
// ---------------------------------------------------------------------------

vi.mock('../../../../lib/api/attachments', () => ({
  uploadAttachments: vi.fn().mockResolvedValue(['id-1']),
}));

vi.mock('../../../../lib/api/chats', () => ({
  getChatMessages: vi.fn().mockResolvedValue([]),
  getChat: vi.fn().mockResolvedValue({ id: 'chat', adapterId: 'claude' }),
  getPendingPermission: vi.fn().mockResolvedValue(null),
  resumeChat: vi.fn().mockResolvedValue(undefined),
  interruptChat: vi.fn().mockResolvedValue(undefined),
  cancelQueuedMessage: vi.fn().mockResolvedValue(undefined),
  editQueuedMessage: vi.fn().mockResolvedValue(undefined),
}));

import { getChatMessages, getPendingPermission } from '../../../../lib/api/chats';
import type { ControlResponse } from '@qlan-ro/mainframe-types';
import { ChatThreadController } from '../chat-thread-controller';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Drain the microtask queue enough to settle async chains. */
async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

// ---------------------------------------------------------------------------
// Fake WS client — captures onEvent so tests can push synthetic events
// ---------------------------------------------------------------------------

interface FakeWs {
  fakeClient: DaemonWsClient;
  pushEvent: (event: DaemonEvent) => void;
}

function makeFakeWs(): FakeWs {
  let capturedHandler: ((event: DaemonEvent) => void) | null = null;

  const fakeClient: DaemonWsClient = {
    get connected() {
      return false;
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

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CHAT_ID = 'chat-restore';
const PORT = 9999;

/** Build an AppendMessage with the given text to use with sendMessage(). */
function textAppendMsg(text: string): AppendMessage {
  return {
    role: 'user',
    content: text ? [{ type: 'text', text }] : [],
    attachments: [],
    parentId: null,
  } as unknown as AppendMessage;
}

/**
 * Build a DisplayMessage of type 'user' carrying a single text content block.
 * Used to populate the history returned by getChatMessages.
 */
function userDisplayMsg(id: string, text: string): DisplayMessage {
  return {
    id,
    chatId: CHAT_ID,
    type: 'user',
    content: [{ type: 'text', text }],
    timestamp: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// 1. Restore pending permission on subscribe:ack — non-null result seeds state
// ---------------------------------------------------------------------------

describe('restorePendingPermission — non-null result', () => {
  it('seeds state.interactions.permissions when getPendingPermission resolves to a ControlRequest', async () => {
    vi.mocked(getPendingPermission).mockResolvedValue({
      requestId: 'rp1',
      toolName: 'ExitPlanMode',
      toolUseId: 'tu9',
      input: { plan: 'x' },
      suggestions: [],
    });

    const { fakeClient, pushEvent } = makeFakeWs();
    const ctrl = new ChatThreadController(CHAT_ID, PORT, fakeClient);
    ctrl.subscribeLive();

    // Deliver the subscribe:ack to trigger handleSubscribeAck → restorePendingPermission.
    pushEvent({ type: 'subscribe:ack', chatId: CHAT_ID });

    // Drain async chains: getPendingPermission promise + dispatch.
    await flushMicrotasks();

    const perms = ctrl.getState().interactions.permissions;
    expect('rp1' in perms).toBe(true);
    expect(perms['rp1']!.request.toolName).toBe('ExitPlanMode');
  });
});

// ---------------------------------------------------------------------------
// 2. Restore pending permission on subscribe:ack — null result leaves empty
// ---------------------------------------------------------------------------

describe('restorePendingPermission — null result', () => {
  it('leaves state.interactions.permissions empty when getPendingPermission resolves to null', async () => {
    vi.mocked(getPendingPermission).mockResolvedValue(null);

    const { fakeClient, pushEvent } = makeFakeWs();
    const ctrl = new ChatThreadController(CHAT_ID, PORT, fakeClient);
    ctrl.subscribeLive();

    pushEvent({ type: 'subscribe:ack', chatId: CHAT_ID });
    await flushMicrotasks();

    expect(Object.keys(ctrl.getState().interactions.permissions)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 3. Restore pending permission — already-seeded requestId is not duplicated
// ---------------------------------------------------------------------------

describe('restorePendingPermission — duplicate guard', () => {
  it('does not dispatch a second time when the requestId is already in state', async () => {
    // First subscribe:ack seeds the permission via a live WS event so we can
    // ensure the state holds 'rp1' before the REST fetch resolves.
    //
    // Strategy: make getPendingPermission return the same requestId that a
    // live 'permission.requested' WS event has already dispatched. After both
    // settle we must still have exactly one entry.

    vi.mocked(getPendingPermission).mockResolvedValue({
      requestId: 'rp-dup',
      toolName: 'Bash',
      toolUseId: 'tu-dup',
      input: { command: 'ls' },
      suggestions: [],
    });

    const { fakeClient, pushEvent } = makeFakeWs();
    const ctrl = new ChatThreadController(CHAT_ID, PORT, fakeClient);
    ctrl.subscribeLive();

    // Deliver the live WS permission event BEFORE the ack so it reaches state first.
    pushEvent({
      type: 'permission.requested',
      chatId: CHAT_ID,
      request: {
        requestId: 'rp-dup',
        toolName: 'Bash',
        toolUseId: 'tu-dup',
        input: { command: 'ls' },
        suggestions: [],
      },
      notify: false,
    });

    // Now deliver the ack, which fires restorePendingPermission.
    pushEvent({ type: 'subscribe:ack', chatId: CHAT_ID });
    await flushMicrotasks();

    // Still exactly one entry — the guard prevented a second dispatch.
    const perms = ctrl.getState().interactions.permissions;
    expect(Object.keys(perms)).toHaveLength(1);
    expect('rp-dup' in perms).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4. Reconcile on history — matching text pending is removed
// ---------------------------------------------------------------------------

describe('reconcilePendingAgainstHistory — matching text', () => {
  it('removes an optimistic pending whose text matches a user message in the re-fetched history', async () => {
    // getChatMessages returns empty on the initial load triggered by subscribe.
    vi.mocked(getChatMessages).mockResolvedValue([]);

    const { fakeClient } = makeFakeWs();
    const ctrl = new ChatThreadController(CHAT_ID, PORT, fakeClient);
    ctrl.subscribeLive();

    // Seed an optimistic pending via sendMessage.
    await ctrl.sendMessage(textAppendMsg('hello reconnect'));

    expect(Object.keys(ctrl.getState().pendingUserMessages)).toHaveLength(1);

    // On refresh the history now contains the server echo of the same message.
    vi.mocked(getChatMessages).mockResolvedValue([userDisplayMsg('srv-1', 'hello reconnect')]);

    await ctrl.refresh();

    // The pending must be reconciled and removed.
    expect(Object.keys(ctrl.getState().pendingUserMessages)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 5. Reconcile on history — non-matching text pending is retained
// ---------------------------------------------------------------------------

describe('reconcilePendingAgainstHistory — non-matching text', () => {
  it('does NOT remove a pending whose text differs from every user message in history', async () => {
    vi.mocked(getChatMessages).mockResolvedValue([]);

    const { fakeClient } = makeFakeWs();
    const ctrl = new ChatThreadController(CHAT_ID, PORT, fakeClient);
    ctrl.subscribeLive();

    await ctrl.sendMessage(textAppendMsg('original message'));

    expect(Object.keys(ctrl.getState().pendingUserMessages)).toHaveLength(1);

    // History contains a user message with completely different text.
    vi.mocked(getChatMessages).mockResolvedValue([userDisplayMsg('srv-2', 'a completely different message')]);

    await ctrl.refresh();

    // The pending must still be present — wrong text means no reconciliation.
    expect(Object.keys(ctrl.getState().pendingUserMessages)).toHaveLength(1);
    expect(Object.values(ctrl.getState().pendingUserMessages)[0]!.text).toBe('original message');
  });
});

// ---------------------------------------------------------------------------
// 6. Count-aware reconcile (identical text)
//
// Two sendMessage() calls whose texts normalize to the same fingerprint produce
// two distinct pendings. Reconcile is COUNT-AWARE and server-authoritative: each
// server copy reconciles AT MOST one pending (oldest first). So two identical
// sends with only ONE server echo reconcile exactly ONE pending — the second is
// a genuine send still awaiting its own echo, NOT a phantom to delete. Two
// server copies reconcile both.
// ---------------------------------------------------------------------------

describe('reconcilePendingAgainstHistory — count-aware (identical text)', () => {
  it('reconciles exactly one pending when two identical sends have only one server echo', async () => {
    vi.mocked(getChatMessages).mockResolvedValue([]);

    const { fakeClient } = makeFakeWs();
    const ctrl = new ChatThreadController(CHAT_ID, PORT, fakeClient);
    ctrl.subscribeLive();

    // Both store text 'ask me two questions' (sendMessage trims); two distinct pendings.
    await ctrl.sendMessage(textAppendMsg('ask me two questions'));
    await ctrl.sendMessage(textAppendMsg(' ask me two questions '));
    expect(Object.keys(ctrl.getState().pendingUserMessages)).toHaveLength(2);

    // Server history has the message exactly once → only one pending reconciles.
    vi.mocked(getChatMessages).mockResolvedValue([userDisplayMsg('srv-dbl-1', 'ask me two questions')]);
    await ctrl.refresh();

    expect(Object.keys(ctrl.getState().pendingUserMessages)).toHaveLength(1);
  });

  it('reconciles both pendings when two identical sends have two server echoes', async () => {
    vi.mocked(getChatMessages).mockResolvedValue([]);

    const { fakeClient } = makeFakeWs();
    const ctrl = new ChatThreadController(CHAT_ID, PORT, fakeClient);
    ctrl.subscribeLive();

    await ctrl.sendMessage(textAppendMsg('ask me two questions'));
    await ctrl.sendMessage(textAppendMsg('ask me two questions'));
    expect(Object.keys(ctrl.getState().pendingUserMessages)).toHaveLength(2);

    // Two legitimate sends → two server copies → both reconcile.
    vi.mocked(getChatMessages).mockResolvedValue([
      userDisplayMsg('srv-dbl-1', 'ask me two questions'),
      userDisplayMsg('srv-dbl-2', 'ask me two questions'),
    ]);
    await ctrl.refresh();

    expect(Object.keys(ctrl.getState().pendingUserMessages)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 7. Reconcile on history — only the matching pending is removed; the other
//    pending (different text) is retained
// ---------------------------------------------------------------------------

describe('reconcilePendingAgainstHistory — partial match: one cleared, one retained', () => {
  it('removes only the pending whose text is in history, leaving the other intact', async () => {
    vi.mocked(getChatMessages).mockResolvedValue([]);

    const { fakeClient } = makeFakeWs();
    const ctrl = new ChatThreadController(CHAT_ID, PORT, fakeClient);
    ctrl.subscribeLive();

    await ctrl.sendMessage(textAppendMsg('first question'));
    await ctrl.sendMessage(textAppendMsg('second question'));

    expect(Object.keys(ctrl.getState().pendingUserMessages)).toHaveLength(2);

    // History only contains the first message — second has not echoed yet.
    vi.mocked(getChatMessages).mockResolvedValue([userDisplayMsg('srv-p1', 'first question')]);

    await ctrl.refresh();

    // Exactly one pending remains — the one whose text is absent from history.
    expect(Object.keys(ctrl.getState().pendingUserMessages)).toHaveLength(1);
    expect(Object.values(ctrl.getState().pendingUserMessages)[0]!.text).toBe('second question');
  });
});

// ---------------------------------------------------------------------------
// 8. Delayed echo — pending older than the live match window reconciles on
//    history re-seed (the history path ignores the time window entirely)
//
// vi.useFakeTimers() is already in beforeEach, so Date.now() is controlled.
// We advance the fake clock by 11 minutes AFTER seeding the pending, making
// its createdAt appear 11 minutes in the past relative to the refresh call.
// The live reconcile path would reject this (window = 10 min), but
// reconcilePendingAgainstHistory is authoritative and must still clear it.
// ---------------------------------------------------------------------------

describe('reconcilePendingAgainstHistory — delayed echo past the live match window', () => {
  it('reconciles a pending older than 10 minutes when history contains the matching text', async () => {
    vi.mocked(getChatMessages).mockResolvedValue([]);

    const { fakeClient } = makeFakeWs();
    const ctrl = new ChatThreadController(CHAT_ID, PORT, fakeClient);
    ctrl.subscribeLive();

    // Seed the pending at t=0.
    await ctrl.sendMessage(textAppendMsg('delayed echo message'));

    expect(Object.keys(ctrl.getState().pendingUserMessages)).toHaveLength(1);

    // Advance the fake clock by 11 minutes so the pending's createdAt is now
    // outside the 10-minute live-match window.
    vi.advanceTimersByTime(11 * 60 * 1000);

    // History now contains the server echo.
    vi.mocked(getChatMessages).mockResolvedValue([userDisplayMsg('srv-late-1', 'delayed echo message')]);

    await ctrl.refresh();

    // The pending must be reconciled despite its age — history path is authoritative.
    expect(Object.keys(ctrl.getState().pendingUserMessages)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 9. Permission-verify timer (#2): answer lost → gate restored after 3s
//
// After replyToPermission the gate is optimistically removed. The controller
// schedules a verify check at PERMISSION_VERIFY_DELAY_MS (3000ms). If
// getPendingPermission still returns the same toolUseId, the WS send was
// dropped and the gate must be re-raised so the user can retry.
// ---------------------------------------------------------------------------

describe('verifyPermissionDelivered — answer lost: gate restored', () => {
  it('re-dispatches permission.requested when getPendingPermission still holds the same toolUseId after 3s', async () => {
    // Seed a permission into state via a live WS event.
    vi.mocked(getPendingPermission).mockResolvedValue(null);

    const { fakeClient, pushEvent } = makeFakeWs();
    const ctrl = new ChatThreadController(CHAT_ID, PORT, fakeClient);
    ctrl.subscribeLive();

    pushEvent({
      type: 'permission.requested',
      chatId: CHAT_ID,
      request: {
        requestId: 'rq1',
        toolName: 'Bash',
        toolUseId: 'tu1',
        input: { command: 'ls' },
        suggestions: [],
      },
      notify: false,
    });

    // Gate is present immediately after the live WS event.
    expect('rq1' in ctrl.getState().interactions.permissions).toBe(true);

    // The user answers. Gate is optimistically removed.
    const response: ControlResponse = {
      requestId: 'rq1',
      toolUseId: 'tu1',
      toolName: 'Bash',
      behavior: 'deny',
    };

    // Daemon still shows the same permission (reply was dropped).
    vi.mocked(getPendingPermission).mockResolvedValue({
      requestId: 'rq1',
      toolName: 'Bash',
      toolUseId: 'tu1',
      input: { command: 'ls' },
      suggestions: [],
    });

    await ctrl.replyToPermission(response);

    // Gate must be gone immediately after reply.
    expect('rq1' in ctrl.getState().interactions.permissions).toBe(false);

    // Advance past PERMISSION_VERIFY_DELAY_MS and drain the promise chain.
    await vi.advanceTimersByTimeAsync(3001);
    await flushMicrotasks();

    // Gate must be restored because the daemon still reports it pending.
    expect('rq1' in ctrl.getState().interactions.permissions).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 10. Permission-verify timer (#2): answer landed → gate NOT restored
//
// If getPendingPermission returns null, the daemon processed our reply. The
// controller must NOT re-raise the gate.
// ---------------------------------------------------------------------------

describe('verifyPermissionDelivered — answer landed: gate stays gone', () => {
  it('does NOT restore the gate when getPendingPermission resolves to null after 3s', async () => {
    vi.mocked(getPendingPermission).mockResolvedValue(null);

    const { fakeClient, pushEvent } = makeFakeWs();
    const ctrl = new ChatThreadController(CHAT_ID, PORT, fakeClient);
    ctrl.subscribeLive();

    pushEvent({
      type: 'permission.requested',
      chatId: CHAT_ID,
      request: {
        requestId: 'rq2',
        toolName: 'Bash',
        toolUseId: 'tu2',
        input: { command: 'pwd' },
        suggestions: [],
      },
      notify: false,
    });

    expect('rq2' in ctrl.getState().interactions.permissions).toBe(true);

    const response: ControlResponse = {
      requestId: 'rq2',
      toolUseId: 'tu2',
      toolName: 'Bash',
      behavior: 'allow',
    };

    // Daemon cleared the pending — answer was received.
    vi.mocked(getPendingPermission).mockResolvedValue(null);

    await ctrl.replyToPermission(response);
    expect('rq2' in ctrl.getState().interactions.permissions).toBe(false);

    await vi.advanceTimersByTimeAsync(3001);
    await flushMicrotasks();

    // Gate must remain absent — daemon confirmed the answer landed.
    expect(Object.keys(ctrl.getState().interactions.permissions)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 11. Restore skips a just-answered tool use (#5)
//
// Within the PERMISSION_VERIFY_DELAY_MS window, a subscribe/reconnect restore
// (handleSubscribeAck → restorePendingPermission) must NOT resurrect the
// permission the user just answered — the reply may still be in flight.
// ---------------------------------------------------------------------------

describe('restorePendingPermission — skips recently-replied toolUseId', () => {
  it('does not restore the gate when the tool use was just answered and the verify window has not elapsed', async () => {
    // Daemon reports the same permission still pending (reply in flight).
    vi.mocked(getPendingPermission).mockResolvedValue({
      requestId: 'rq3',
      toolName: 'Bash',
      toolUseId: 'tu3',
      input: { command: 'echo hi' },
      suggestions: [],
    });

    const { fakeClient, pushEvent } = makeFakeWs();
    const ctrl = new ChatThreadController(CHAT_ID, PORT, fakeClient);
    ctrl.subscribeLive();

    // Seed the permission via a live WS event.
    pushEvent({
      type: 'permission.requested',
      chatId: CHAT_ID,
      request: {
        requestId: 'rq3',
        toolName: 'Bash',
        toolUseId: 'tu3',
        input: { command: 'echo hi' },
        suggestions: [],
      },
      notify: false,
    });
    expect('rq3' in ctrl.getState().interactions.permissions).toBe(true);

    // User answers — gate is optimistically dropped and toolUseId is tracked.
    const response: ControlResponse = {
      requestId: 'rq3',
      toolUseId: 'tu3',
      toolName: 'Bash',
      behavior: 'deny',
    };
    await ctrl.replyToPermission(response);
    expect('rq3' in ctrl.getState().interactions.permissions).toBe(false);

    // Trigger a restore via a subscribe:ack (simulating reconnect) — still within
    // the 3000ms verify window, so recentlyRepliedToolUseIds still contains 'tu3'.
    pushEvent({ type: 'subscribe:ack', chatId: CHAT_ID });
    await flushMicrotasks();

    // The anti-flicker guard must suppress the restore.
    expect('rq3' in ctrl.getState().interactions.permissions).toBe(false);
    expect(Object.keys(ctrl.getState().interactions.permissions)).toHaveLength(0);
  });
});
