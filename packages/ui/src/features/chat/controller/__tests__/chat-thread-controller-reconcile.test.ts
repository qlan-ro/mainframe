/**
 * Behavior tests for the optimistic-send reconcile (judo-A, load-bearing
 * behavior #1): count-aware, server-authoritative, oldest-first, each server
 * copy clears at most one pending; no time window, no empty-text wildcard,
 * no over-clearing of legitimate duplicate sends.
 *
 * The mechanism moved from a `display.message.added`/`display.messages.set`
 * DaemonEvent handler to `AcpChatController.dispatchFromPlane`: every ACP
 * `transcript.updated` re-runs `reconcilePendings` against
 * `plane.userMessageContents()` (raw text, sentinels intact). Server echoes
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

import { CHAT_ID, makeCompleteAttachment, makeController, makeMsg } from './acp-test-kit';

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
