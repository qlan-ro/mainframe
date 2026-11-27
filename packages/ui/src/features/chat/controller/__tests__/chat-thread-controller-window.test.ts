/**
 * The controller's side of a window around a jump target: what takes the reader back to the tail
 * (their own send), and what makes the snapshot fetch again (the end of a turn, a compaction, a
 * cleared transcript).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../lib/api/attachments', () => ({ uploadAttachments: vi.fn() }));
vi.mock('../../../../lib/api/chats', () => ({
  getChat: vi.fn().mockResolvedValue(null),
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

import type { HistoryAroundResult, SessionUpdate } from '@qlan-ro/mainframe-types';
import { useUiPrefs } from '@/store/ui-prefs';
import { getChat } from '../../../../lib/api/chats';
import { exportConversation } from '../../messages/transcript-markdown';
import { CHAT_ID, flushMicrotasks, makeChat, makeController, makeMsg, type ControllerRig } from './acp-test-kit';

function item(id: string, role: 'user_message' | 'agent_message'): SessionUpdate {
  return {
    sessionUpdate: role,
    messageId: id,
    content: [{ type: 'text', text: id }],
    _meta: { '_mainframe.dev': { containerId: id } },
  } as SessionUpdate;
}

const WINDOW: HistoryAroundResult = {
  updates: [item('u2', 'user_message'), item('a2', 'agent_message')],
  hasBefore: true,
  hasAfter: true,
  firstItemId: 'u2',
  lastItemId: 'a2',
  targetItemId: 'a2',
};

async function away(): Promise<{ rig: ControllerRig; around: ReturnType<typeof vi.fn> }> {
  vi.mocked(getChat).mockResolvedValue(makeChat());
  const rig = makeController(CHAT_ID, { capabilities: { windowedHistory: true, historyAround: true } });
  rig.acpClient.nextResumeMeta = { history: { hasMore: true, floorItemId: 'u9' } } as never;
  await rig.ctrl.load();
  for (const update of [item('u9', 'user_message'), item('a9', 'agent_message')])
    rig.acpClient.emitUpdate(CHAT_ID, update);
  const around = vi.fn().mockResolvedValue(WINDOW);
  rig.acpClient.historyAround = around as never;
  expect(await rig.ctrl.loadEarlier('a2')).toBe(true);
  return { rig, around };
}

const live = (rig: ControllerRig) => rig.ctrl.getState().messages.map((m) => m.id);
const shown = (rig: ControllerRig) => rig.ctrl.getState().windowMessages?.map((m) => m.id) ?? null;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.stubGlobal('window', new EventTarget());
  useUiPrefs.setState({ plainTranscript: true, historyTurns: 2 });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  useUiPrefs.setState({ plainTranscript: false });
});

describe('a window around a jump target, in the controller', () => {
  it('shows the window apart from the live transcript, and marks the history state detached', async () => {
    const { rig } = await away();
    expect(shown(rig)).toEqual(['u2', 'a2']);
    expect(rig.ctrl.shownMessages.map((m) => m.id)).toEqual(['u2', 'a2']);
    expect(rig.ctrl.getState().historyWindow.detached).toMatchObject({ hasBefore: true, hasAfter: true });
  });

  it('takes the reader back to the tail when they send', async () => {
    const { rig } = await away();
    await rig.ctrl.sendMessage(makeMsg('hello'));
    expect(rig.ctrl.getState().historyWindow.detached).toBeUndefined();
    expect(shown(rig)).toBeNull();
    expect(live(rig)).toEqual(['u9', 'a9']);
  });

  it('returns on request, and loadLater at the end of the window is the same way back', async () => {
    const { rig, around } = await away();
    around.mockResolvedValueOnce({
      ...WINDOW,
      updates: [item('a2', 'agent_message')],
      hasAfter: false,
      lastItemId: 'a2',
    });
    await rig.ctrl.loadLater();
    expect(rig.ctrl.getState().historyWindow.detached).toMatchObject({ hasAfter: false });
    await rig.ctrl.loadLater();
    expect(rig.ctrl.getState().historyWindow.detached).toBeUndefined();
    expect(shown(rig)).toBeNull();
  });

  it('keeps the live transcript for export, which pages the live window and leaves the jump window alone', async () => {
    const { rig, around } = await away();
    expect(live(rig)).toEqual(['u9', 'a9']);
    around.mockClear();
    rig.acpClient.historyPage = vi.fn(async (_params, apply) =>
      apply({
        hasMore: false,
        floorItemId: 'u8',
        updates: [item('u8', 'user_message'), item('a8', 'agent_message')],
      }),
    ) as never;
    const markdown = await exportConversation(rig.ctrl);
    expect(markdown).toContain('u8');
    expect(markdown).toContain('a9');
    expect(markdown).not.toContain('a2');
    expect(around).not.toHaveBeenCalled();
    expect(rig.acpClient.historyPage).toHaveBeenCalledWith(
      expect.objectContaining({ before: 'u9' }),
      expect.anything(),
    );
    expect(shown(rig)).toEqual(['u2', 'a2']);
    expect(rig.ctrl.getState().historyWindow.detached).toBeDefined();
  });

  it.each([
    [
      'the end of a turn',
      (rig: ControllerRig) =>
        rig.acpClient.emitUpdate(CHAT_ID, { sessionUpdate: 'state_update', state: 'idle' } as SessionUpdate),
    ],
    ['a compaction', (rig: ControllerRig) => rig.acpClient.emitCompaction(CHAT_ID, 'done')],
    ['a cleared transcript', (rig: ControllerRig) => rig.acpClient.emitTranscriptCleared(CHAT_ID)],
  ])('cuts the snapshot again after %s', async (_name, trigger) => {
    const { rig, around } = await away();
    around.mockClear();
    trigger(rig);
    await vi.advanceTimersByTimeAsync(2000);
    await flushMicrotasks();
    expect(around).toHaveBeenCalledWith({ sessionId: CHAT_ID, itemId: 'a2', before: 1, after: 0 });
  });
});
