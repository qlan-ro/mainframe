/**
 * useChatThreadRuntime — composer-draft continuity across an offload release
 * (#178, AC14). Mirrors the mock harness of use-chat-thread-runtime-restore.test.tsx:
 * `useExternalStoreRuntime` returns a fake runtime exposing the composer surface
 * the hook reads (setText/addAttachment/getState).
 */
import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AcpChatController } from '../../controller/acp-chat-controller';
import type { ChatThreadState } from '../../controller/chat-thread-state';

vi.mock('../../../sessions/runtime/new-thread-coordinator', () => ({
  createForLocal: vi.fn().mockResolvedValue({ remoteId: 'chat-77' }),
}));

vi.mock('../../../sessions/runtime/chat-controller-registry', () => ({
  chatControllerRegistry: { adopt: vi.fn() },
}));

const setTextSpy = vi.fn();
const addAttachmentSpy = vi.fn().mockResolvedValue(undefined);
let composerState: { text: string; attachments: { file?: File }[] } = { text: '', attachments: [] };
const getStateSpy = vi.fn(() => composerState);

vi.mock('@assistant-ui/react', () => ({
  useExternalStoreRuntime: () => ({
    thread: { composer: { setText: setTextSpy, addAttachment: addAttachmentSpy, getState: getStateSpy } },
  }),
  useAuiState: vi.fn(() => undefined),
}));

vi.mock('../../composer/attachment-adapter', () => ({
  createAttachmentAdapter: () => ({}),
}));

vi.mock('../../controller/project-messages', () => ({
  projectChatThreadRepository: () => ({ getMessages: () => [] }),
}));

vi.mock('../../gates/select-front', () => ({
  selectPermissionFront: () => undefined,
}));

import { useChatThreadRuntime } from '../use-chat-thread-runtime';
import { createChatThreadState } from '../../controller/chat-thread-state';
import { markForStash, takeStash } from '../draft-stash';

function makeController(chatId: string): AcpChatController {
  const stableState: ChatThreadState = createChatThreadState(chatId);
  return {
    subscribeState: (_l: () => void) => () => {},
    subscribeLive: () => () => {},
    setActive: (_active: boolean) => {},
    getState: () => stableState,
    getThreadId: () => chatId,
    hasRemoteId: () => true,
    load: vi.fn().mockResolvedValue(undefined),
    setRemoteId: vi.fn(),
    sendMessage: vi.fn().mockResolvedValue(undefined),
    markAttachmentsRestoredForFailure: vi.fn(),
    cancel: vi.fn().mockResolvedValue(undefined),
    replyToPermission: vi.fn().mockResolvedValue(undefined),
    cancelQueued: vi.fn().mockResolvedValue(undefined),
    editQueued: vi.fn().mockResolvedValue(undefined),
    refresh: vi.fn().mockResolvedValue(undefined),
  } as unknown as AcpChatController;
}

const PORT = 9999;

beforeEach(() => {
  vi.clearAllMocks();
  composerState = { text: '', attachments: [] };
});

describe('useChatThreadRuntime — draft-stash restore on mount', () => {
  it('applies a stash left for this thread id: text and attachments', async () => {
    const { captureIfMarked } = await import('../draft-stash');
    markForStash('chat-restore-2');
    captureIfMarked('chat-restore-2', { text: 'draft text', attachments: [new File(['x'], 'a.png')] });

    const controller = makeController('chat-restore-2');
    const { unmount } = renderHook(() => useChatThreadRuntime(controller, PORT, { active: false }));

    expect(setTextSpy).toHaveBeenCalledWith('draft text');
    expect(addAttachmentSpy).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('does nothing when no stash exists for this thread id', () => {
    const controller = makeController('chat-restore-none');
    const { unmount } = renderHook(() => useChatThreadRuntime(controller, PORT, { active: false }));

    expect(setTextSpy).not.toHaveBeenCalled();
    expect(addAttachmentSpy).not.toHaveBeenCalled();
    unmount();
  });
});

describe('useChatThreadRuntime — draft-stash capture on unmount', () => {
  it('captures the composer draft on unmount when the thread was marked for stash', () => {
    markForStash('chat-capture-1');
    const file = new File(['x'], 'b.png');
    composerState = { text: 'unsent message', attachments: [{ file }] };

    const controller = makeController('chat-capture-1');
    const { unmount } = renderHook(() => useChatThreadRuntime(controller, PORT, { active: false }));
    unmount();

    expect(takeStash('chat-capture-1')).toEqual({ text: 'unsent message', attachments: [file] });
  });

  it('does not stash on an unmount that was never marked', () => {
    composerState = { text: 'irrelevant', attachments: [] };
    const controller = makeController('chat-capture-2');
    const { unmount } = renderHook(() => useChatThreadRuntime(controller, PORT, { active: false }));
    unmount();

    expect(takeStash('chat-capture-2')).toBeUndefined();
  });

  it('drops attachments with no File reference (already-sent/no-file attachments)', () => {
    markForStash('chat-capture-3');
    composerState = { text: '', attachments: [{ file: undefined }] };
    const controller = makeController('chat-capture-3');
    const { unmount } = renderHook(() => useChatThreadRuntime(controller, PORT, { active: false }));
    unmount();

    expect(takeStash('chat-capture-3')).toEqual({ text: '', attachments: [] });
  });
});
