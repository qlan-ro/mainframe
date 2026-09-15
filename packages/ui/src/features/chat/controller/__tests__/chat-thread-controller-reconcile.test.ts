/**
 * Behavior tests for the optimistic-send reconcile (judo-A, load-bearing
 * behavior #1): count-aware, server-authoritative, oldest-first, each server
 * copy clears at most one pending; no time window, no empty-text wildcard,
 * no over-clearing of legitimate duplicate sends.
 *
 * The mechanism moved from a `display.message.added`/`display.messages.set`
 * DaemonEvent handler to `AcpChatController.dispatchFromPlane`: every ACP
 * `transcript.updated` re-runs `reconcilePendings` against the user messages
 * the plane has not fed it before (raw text, sentinels intact). Server echoes
 * are simulated here as `user_message` SessionUpdates on the fake ACP client.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../lib/api/attachments', () => ({
  uploadAttachments: vi.fn().mockResolvedValue(['id-1']),
}));
vi.mock('../../../../lib/api/chats', () => ({
  getChat: vi.fn().mockResolvedValue({ id: 'chat-abc', adapterId: 'claude' }),
  getChatWorkflowRuns: vi.fn().mockResolvedValue([]),
  resumeChat: vi.fn().mockResolvedValue(undefined),
  cancelQueuedMessage: vi.fn().mockResolvedValue(undefined),
  editQueuedMessage: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../../../lib/api/git', () => ({
  acceptWorktreeOffer: vi.fn().mockResolvedValue(undefined),
  dismissWorktreeOffer: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/toast', () => ({
  mfToast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn(), permission: vi.fn() },
}));

import { createChatThreadState, reduceChatThreadState } from '../chat-thread-state';
import { CHAT_ID, flushMicrotasks, makeCompleteAttachment, makeController, makeMsg } from './acp-test-kit';

function pendingTexts(ctrl: ReturnType<typeof makeController>['ctrl']): string[] {
  return Object.values(ctrl.getState().pendingUserMessages).map((p) => p.text);
}

function userEcho(messageId: string, text: string) {
  return { sessionUpdate: 'user_message' as const, messageId, content: [{ type: 'text' as const, text }] };
}

function imageOnlyEcho(messageId: string) {
  return {
    sessionUpdate: 'user_message' as const,
    messageId,
    content: [{ type: 'image' as const, mimeType: 'image/png', data: 'aGVsbG8=' }],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('reconcile — attachment-only optimistic send', () => {
  it('clears the pending when the echo has only an image block (no text)', async () => {
    const { ctrl, acpClient } = makeController();
    await ctrl.sendMessage(makeMsg('', [makeCompleteAttachment('photo.png')]));
    expect(Object.keys(ctrl.getState().pendingUserMessages)).toHaveLength(1);

    acpClient.emitUpdate(CHAT_ID, imageOnlyEcho('srv-1'));

    expect(Object.keys(ctrl.getState().pendingUserMessages)).toHaveLength(0);
  });

  it('does NOT clear an attachment-only pending when the echo carries text', async () => {
    const { ctrl, acpClient } = makeController();
    await ctrl.sendMessage(makeMsg('', [makeCompleteAttachment('photo.png')]));

    acpClient.emitUpdate(CHAT_ID, userEcho('srv-2', 'some text from another message'));

    expect(Object.keys(ctrl.getState().pendingUserMessages)).toHaveLength(1);
  });

  it('does NOT clear a text pending when the echo has no text block', async () => {
    const { ctrl, acpClient } = makeController();
    await ctrl.sendMessage(makeMsg('hello world'));

    acpClient.emitUpdate(CHAT_ID, imageOnlyEcho('srv-3'));

    expect(pendingTexts(ctrl)).toEqual(['hello world']);
  });
});

describe('reconcile — text fingerprint match', () => {
  it('clears a pending when the echoed text normalizes to the same fingerprint', async () => {
    const { ctrl, acpClient } = makeController();
    await ctrl.sendMessage(makeMsg('  Hello   World  '));
    expect(pendingTexts(ctrl)).toEqual(['Hello   World']);

    acpClient.emitUpdate(CHAT_ID, userEcho('srv-4', 'Hello   World'));

    expect(Object.keys(ctrl.getState().pendingUserMessages)).toHaveLength(0);
  });

  it('does not clear when the fingerprints differ', async () => {
    const { ctrl, acpClient } = makeController();
    await ctrl.sendMessage(makeMsg('hello'));

    acpClient.emitUpdate(CHAT_ID, userEcho('srv-5', 'goodbye'));

    expect(pendingTexts(ctrl)).toEqual(['hello']);
  });
});

describe('reconcile — count-aware (identical text)', () => {
  it('clears exactly one pending when two identical sends have only one server echo', async () => {
    const { ctrl, acpClient } = makeController();
    await ctrl.sendMessage(makeMsg('ask me two questions'));
    await ctrl.sendMessage(makeMsg(' ask me two questions '));
    expect(Object.keys(ctrl.getState().pendingUserMessages)).toHaveLength(2);

    acpClient.emitUpdate(CHAT_ID, userEcho('srv-dbl-1', 'ask me two questions'));

    expect(Object.keys(ctrl.getState().pendingUserMessages)).toHaveLength(1);
  });

  it('clears both pendings when two identical sends have two server echoes', async () => {
    const { ctrl, acpClient } = makeController();
    await ctrl.sendMessage(makeMsg('ask me two questions'));
    await ctrl.sendMessage(makeMsg('ask me two questions'));
    expect(Object.keys(ctrl.getState().pendingUserMessages)).toHaveLength(2);

    acpClient.emitUpdate(CHAT_ID, {
      sessionUpdate: 'user_message',
      messageId: 's1',
      content: [{ type: 'text', text: 'ask me two questions' }],
    });
    acpClient.emitUpdate(CHAT_ID, {
      sessionUpdate: 'user_message',
      messageId: 's2',
      content: [{ type: 'text', text: 'ask me two questions' }],
    });

    expect(Object.keys(ctrl.getState().pendingUserMessages)).toHaveLength(0);
  });
});

describe('reconcile — partial match: one cleared, one retained', () => {
  it('clears only the pending whose text echoed, leaving the other intact', async () => {
    const { ctrl, acpClient } = makeController();
    await ctrl.sendMessage(makeMsg('first question'));
    await ctrl.sendMessage(makeMsg('second question'));
    expect(Object.keys(ctrl.getState().pendingUserMessages)).toHaveLength(2);

    acpClient.emitUpdate(CHAT_ID, userEcho('srv-p1', 'first question'));

    expect(pendingTexts(ctrl)).toEqual(['second question']);
  });
});

describe('reconcile — no time window', () => {
  it('clears a pending regardless of elapsed time since it was sent', async () => {
    vi.useFakeTimers();
    try {
      const { ctrl, acpClient } = makeController();
      await ctrl.sendMessage(makeMsg('delayed echo message'));
      expect(Object.keys(ctrl.getState().pendingUserMessages)).toHaveLength(1);

      vi.advanceTimersByTime(11 * 60 * 1000);

      acpClient.emitUpdate(CHAT_ID, userEcho('srv-late-1', 'delayed echo message'));

      expect(Object.keys(ctrl.getState().pendingUserMessages)).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('reconcile — oldest-first', () => {
  it('reconciles the oldest matching pending first when only one server copy arrives', async () => {
    const { ctrl, acpClient } = makeController();
    await ctrl.sendMessage(makeMsg('same text'));
    const firstClientId = Object.keys(ctrl.getState().pendingUserMessages)[0]!;
    await ctrl.sendMessage(makeMsg('same text'));

    acpClient.emitUpdate(CHAT_ID, userEcho('srv-oldest', 'same text'));

    const remaining = Object.keys(ctrl.getState().pendingUserMessages);
    expect(remaining).toHaveLength(1);
    expect(remaining).not.toContain(firstClientId);
  });
});

describe('reconcile — suffix-only feed, not the whole history (T25, R3.3, blocker)', () => {
  it('a history duplicate does not satisfy a new pending — only the live echo does', async () => {
    const { ctrl, acpClient } = makeController();
    await ctrl.load();
    // A prior "continue" already sits in the loaded transcript, before any pending exists.
    acpClient.emitUpdate(CHAT_ID, userEcho('hist-1', 'continue'));

    await ctrl.sendMessage(makeMsg('continue'));
    const [pendingId] = Object.keys(ctrl.getState().pendingUserMessages);
    expect(pendingId).toBeDefined();

    // An unrelated transcript.updated (no new user message) must not
    // re-match the pending against the OLD historical "continue".
    acpClient.emitUpdate(CHAT_ID, {
      sessionUpdate: 'agent_message_chunk',
      messageId: 'a1',
      content: { type: 'text', text: 'thinking…' },
    });
    expect(ctrl.getState().pendingUserMessages[pendingId!]?.status).toBe('pending');

    // The real echo finally arrives.
    acpClient.emitUpdate(CHAT_ID, userEcho('live-1', 'continue'));
    expect(Object.keys(ctrl.getState().pendingUserMessages)).toHaveLength(0);
  });
});

describe('reconcile — a replay of the same history feeds the matcher nothing (R3.3)', () => {
  it('a resync replay leaves the new pending outstanding; only the live echo clears it', async () => {
    const { ctrl, acpClient } = makeController();
    await ctrl.load();
    // Two prior user messages already sit in the loaded transcript, before
    // any pending exists — the duplicate is the SECOND, so re-baselining on
    // the first replayed frame alone would still feed it to the matcher.
    acpClient.emitUpdate(CHAT_ID, userEcho('hist-1', 'hello'));
    acpClient.emitUpdate(CHAT_ID, userEcho('hist-2', 'continue'));

    await ctrl.sendMessage(makeMsg('continue'));
    const [pendingId] = Object.keys(ctrl.getState().pendingUserMessages);
    expect(pendingId).toBeDefined();

    // `_mainframe.dev/resync` → reattach(): the accumulator is reset and the
    // daemon re-replays the SAME history, one frame per item, under the same
    // stable item ids.
    acpClient.emitResync(CHAT_ID);
    await flushMicrotasks();
    acpClient.emitUpdate(CHAT_ID, userEcho('hist-1', 'hello'));
    acpClient.emitUpdate(CHAT_ID, userEcho('hist-2', 'continue'));

    expect(ctrl.getState().pendingUserMessages[pendingId!]?.status).toBe('pending');

    // The pending's own echo finally arrives, under an id never seen before.
    acpClient.emitUpdate(CHAT_ID, userEcho('live-2', 'continue'));
    expect(Object.keys(ctrl.getState().pendingUserMessages)).toHaveLength(0);
  });
});

describe('reconcile — a failed send keeps its failure indicator (T25, R3.3)', () => {
  it('local.message.failed re-creates a failed entry even when the pending was already removed from state', () => {
    const state = createChatThreadState('chat-1');
    const pending = {
      clientId: 'client-gone',
      chatId: 'chat-1',
      text: 'flaky send',
      createdAt: 1_700_000_000_000,
      status: 'pending' as const,
    };

    // No 'local.message.queued' was dispatched onto this state — clientId
    // is not present, simulating a pending that a correct reconcile already
    // cleared (or one that never made it into this exact state snapshot).
    const next = reduceChatThreadState(state, {
      type: 'local.message.failed',
      clientId: pending.clientId,
      error: new Error('socket closed'),
      stage: 'send',
      pending,
    });

    expect(next.pendingUserMessages[pending.clientId]).toMatchObject({
      status: 'failed',
      text: 'flaky send',
    });
  });
});
