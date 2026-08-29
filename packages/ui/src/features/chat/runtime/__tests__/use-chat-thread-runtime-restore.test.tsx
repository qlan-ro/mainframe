/**
 * Behavior test: a failed send puts the message's attachments back into the
 * composer (task 5, todo #219).
 *
 * Mirrors the mock harness of use-chat-thread-runtime-active.test.tsx (same
 * `createForLocal`/`attachment-adapter`/`project-messages`/`select-front`
 * mocks); the `useExternalStoreRuntime` mock is extended to return a fake
 * runtime object exposing `thread.composer.addAttachment`, since the restore
 * path calls it on the runtime the hook itself produced.
 */
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AcpChatController } from '../../controller/acp-chat-controller';
import type { AppendMessage } from '@assistant-ui/react';

vi.mock('../../../sessions/runtime/new-thread-coordinator', () => ({
  createForLocal: vi.fn().mockResolvedValue({ remoteId: 'chat-77' }),
}));

vi.mock('../../../sessions/runtime/chat-controller-registry', () => ({
  chatControllerRegistry: { adopt: vi.fn() },
}));

const addAttachmentSpy = vi.fn().mockResolvedValue(undefined);

type ExternalStoreOpts = {
  onNew?: (msg: AppendMessage) => Promise<void>;
  [key: string]: unknown;
};

const capturedOnNew: { current: ((msg: AppendMessage) => Promise<void>) | undefined } = { current: undefined };

vi.mock('@assistant-ui/react', () => ({
  useExternalStoreRuntime: (opts: ExternalStoreOpts) => {
    capturedOnNew.current = opts.onNew;
    return { thread: { composer: { addAttachment: addAttachmentSpy } } };
  },
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

import { useChatThreadRuntime as _useChatThreadRuntime } from '../use-chat-thread-runtime';
import { createChatThreadState } from '../../controller/chat-thread-state';
import type { ChatThreadState } from '../../controller/chat-thread-state';
import type { AssistantRuntime } from '@assistant-ui/react';

const useChatThreadRuntime = _useChatThreadRuntime as (
  controller: AcpChatController,
  port: number,
  opts?: { active?: boolean },
) => AssistantRuntime;

const PORT = 9999;

function makeController(
  sendMessage: (msg: AppendMessage) => Promise<void>,
  opts: { hasRemoteId?: boolean } = {},
): AcpChatController {
  const stableState: ChatThreadState = createChatThreadState('chat-existing');
  return {
    subscribeState: (_l: () => void) => () => {},
    subscribeLive: () => () => {},
    getState: () => stableState,
    getThreadId: () => 'chat-existing',
    hasRemoteId: () => opts.hasRemoteId ?? true,
    load: vi.fn().mockResolvedValue(undefined),
    setRemoteId: vi.fn(),
    sendMessage: vi.fn(sendMessage),
    markAttachmentsRestoredForFailure: vi.fn(),
    cancel: vi.fn().mockResolvedValue(undefined),
    replyToPermission: vi.fn().mockResolvedValue(undefined),
    cancelQueued: vi.fn().mockResolvedValue(undefined),
    editQueued: vi.fn().mockResolvedValue(undefined),
    refresh: vi.fn().mockResolvedValue(undefined),
  } as unknown as AcpChatController;
}

function makeFile(name: string): File {
  return new File(['x'], name, { type: 'image/png' });
}

function messageWithAttachments(files: File[]): AppendMessage {
  return {
    role: 'user',
    content: [{ type: 'text', text: 'hi' }],
    attachments: files.map((file, i) => ({
      id: `att-${i}`,
      type: 'image',
      name: file.name,
      contentType: file.type,
      status: { type: 'complete' },
      content: [],
      file,
    })),
    parentId: null,
  } as unknown as AppendMessage;
}

beforeEach(() => {
  vi.clearAllMocks();
  capturedOnNew.current = undefined;
});

describe('useChatThreadRuntime — attachments return to the composer on a failed send', () => {
  it('calls addAttachment once per file, in order, when sendMessage rejects with a 401', async () => {
    const authError = Object.assign(new Error('Unauthorized'), { status: 401 });
    const controller = makeController(() => Promise.reject(authError));
    const { unmount } = renderHook(() => useChatThreadRuntime(controller, PORT, { active: false }));

    const fileA = makeFile('a.png');
    const fileB = makeFile('b.png');
    const msg = messageWithAttachments([fileA, fileB]);

    await act(async () => {
      await expect(capturedOnNew.current?.(msg)).rejects.toBe(authError);
    });

    expect(addAttachmentSpy).toHaveBeenCalledTimes(2);
    expect(addAttachmentSpy.mock.calls[0]![0]).toBe(fileA);
    expect(addAttachmentSpy.mock.calls[1]![0]).toBe(fileB);
    unmount();
  });

  it('still rejects onNew with the original error (the caller must see the failure)', async () => {
    const authError = Object.assign(new Error('Unauthorized'), { status: 401 });
    const controller = makeController(() => Promise.reject(authError));
    const { unmount } = renderHook(() => useChatThreadRuntime(controller, PORT, { active: false }));

    const msg = messageWithAttachments([makeFile('a.png')]);

    await expect(capturedOnNew.current?.(msg)).rejects.toBe(authError);
    unmount();
  });

  it('never calls addAttachment when sendMessage resolves', async () => {
    const controller = makeController(() => Promise.resolve());
    const { unmount } = renderHook(() => useChatThreadRuntime(controller, PORT, { active: false }));

    const msg = messageWithAttachments([makeFile('a.png')]);

    await act(async () => {
      await capturedOnNew.current?.(msg);
    });

    expect(addAttachmentSpy).not.toHaveBeenCalled();
    unmount();
  });

  it('never calls addAttachment for a rejecting send with no attachments, and still rejects', async () => {
    const boom = new Error('boom');
    const controller = makeController(() => Promise.reject(boom));
    const { unmount } = renderHook(() => useChatThreadRuntime(controller, PORT, { active: false }));

    const msg = messageWithAttachments([]);

    await expect(capturedOnNew.current?.(msg)).rejects.toBe(boom);
    expect(addAttachmentSpy).not.toHaveBeenCalled();
    unmount();
  });

  it('restores attachments when createForLocal rejects (no remoteId yet, e.g. a stale token 401ing createChat)', async () => {
    const { createForLocal } = await import('../../../sessions/runtime/new-thread-coordinator');
    const authError = Object.assign(new Error('Unauthorized'), { status: 401 });
    vi.mocked(createForLocal).mockRejectedValueOnce(authError);

    const sendMessage = vi.fn().mockResolvedValue(undefined);
    const controller = makeController(sendMessage, { hasRemoteId: false });
    const { unmount } = renderHook(() => useChatThreadRuntime(controller, PORT, { active: false }));

    const fileA = makeFile('a.png');
    const msg = messageWithAttachments([fileA]);

    await expect(capturedOnNew.current?.(msg)).rejects.toBe(authError);

    expect(sendMessage).not.toHaveBeenCalled();
    expect(addAttachmentSpy).toHaveBeenCalledTimes(1);
    expect(addAttachmentSpy.mock.calls[0]![0]).toBe(fileA);
    unmount();
  });

  it('marks the pending failure only after every attachment was restored', async () => {
    const authError = Object.assign(new Error('Unauthorized'), { status: 401 });
    const controller = makeController(() => Promise.reject(authError));
    const { unmount } = renderHook(() => useChatThreadRuntime(controller, PORT, { active: false }));

    const msg = messageWithAttachments([makeFile('a.png'), makeFile('b.png')]);

    await expect(capturedOnNew.current?.(msg)).rejects.toBe(authError);

    expect(controller.markAttachmentsRestoredForFailure).toHaveBeenCalledWith(authError);
    unmount();
  });

  it('does not mark attachments restored when a re-add fails', async () => {
    addAttachmentSpy.mockRejectedValueOnce(new Error('add failed'));
    const authError = Object.assign(new Error('Unauthorized'), { status: 401 });
    const controller = makeController(() => Promise.reject(authError));
    const { unmount } = renderHook(() => useChatThreadRuntime(controller, PORT, { active: false }));

    const msg = messageWithAttachments([makeFile('a.png'), makeFile('b.png')]);

    await expect(capturedOnNew.current?.(msg)).rejects.toBe(authError);

    expect(controller.markAttachmentsRestoredForFailure).not.toHaveBeenCalled();
    unmount();
  });
});
