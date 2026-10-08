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

vi.mock('../../controller/transcript-projector', () => ({
  TranscriptProjector: class {
    projectRepository() {
      return { messages: [] };
    }
    projectMessages() {
      return [];
    }
  },
}));

vi.mock('../../gates/select-front', () => ({
  selectPermissionFront: () => undefined,
}));

import { useChatThreadRuntime } from '../use-chat-thread-runtime';
import { createChatThreadState } from '../../controller/chat-thread-state';
import { markForStash, seedDraft, takeStash } from '../draft-stash';

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

  // #178 AC14's alias case (finding 3/7): a chat created THIS app session has
  // two live thread items — the orphaned `__LOCALID_*` draft and the
  // canonical daemon-id item — sharing ONE adopted controller whose
  // `getThreadId()` always returns the constructor (`__LOCALID_*`) id for
  // BOTH subtrees. Keying capture/restore by `controller.getThreadId()`
  // collided both subtrees' unmount captures onto that single key, dropping
  // whichever fired second. Passing `chatId` (the subtree's own thread-list-
  // item id, matching what `OffloadRelease.markForStash` and
  // `chatControllerRegistry.getOrCreate` use) must keep them independent.
  it('captures each alias subtree under its OWN item id, not the shared controller id', () => {
    const sharedController = makeController('__LOCALID_alias1');
    markForStash('__LOCALID_alias1');
    markForStash('chat-canonical-1');

    // The orphaned draft subtree's composer is empty when it unmounts.
    composerState = { text: '', attachments: [] };
    const draftSubtree = renderHook(() =>
      useChatThreadRuntime(sharedController, PORT, { active: false, chatId: '__LOCALID_alias1' }),
    );
    draftSubtree.unmount();

    // The canonical subtree holds the text the user actually typed.
    composerState = { text: 'typed in the canonical subtree', attachments: [] };
    const canonicalSubtree = renderHook(() =>
      useChatThreadRuntime(sharedController, PORT, { active: false, chatId: 'chat-canonical-1' }),
    );
    canonicalSubtree.unmount();

    expect(takeStash('chat-canonical-1')).toEqual({
      text: 'typed in the canonical subtree',
      attachments: [],
    });
    expect(takeStash('__LOCALID_alias1')).toEqual({ text: '', attachments: [] });
  });
});

// `splitFits` lags `zones` (its ResizeObserver settles async, after the
// workspace panel parks to free the width — review follow-up on 214de9d4):
// this instance can correctly be "the one displayed" for a beat, take the
// stash, and then lose that status once `ChatZone` mounts. The handoff below
// hands whatever the composer holds back to the stash at that exact moment,
// so `ChatZone`'s own restore still finds it instead of a now-empty composer.
describe('useChatThreadRuntime — handoff when losing displayed status mid-flight', () => {
  it('re-stashes the composer’s CURRENT content (the user’s edit, not the stale original) when skipDraftRestore flips true', () => {
    seedDraft('chat-handoff-1', 'original prefill');
    composerState = { text: 'original prefill', attachments: [] };
    const controller = makeController('chat-handoff-1');
    const { rerender, unmount } = renderHook(
      ({ skip }: { skip: boolean }) =>
        useChatThreadRuntime(controller, PORT, { active: false, chatId: 'chat-handoff-1', skipDraftRestore: skip }),
      { initialProps: { skip: false } },
    );
    expect(setTextSpy).toHaveBeenCalledWith('original prefill');
    expect(takeStash('chat-handoff-1')).toBeUndefined(); // one-shot: already taken

    // The user edits it before the layout (e.g. a split catching up with a
    // just-parked workspace panel) makes this instance stop being displayed.
    composerState = { text: 'user edited text', attachments: [] };
    rerender({ skip: true });

    // Handed off for the next consumer (ChatZone's own restore) to take.
    expect(takeStash('chat-handoff-1')).toEqual({ text: 'user edited text', attachments: [] });
    // Cleared locally too, so an unsplit back to this instance later doesn't
    // resurrect the handed-off text stale.
    expect(setTextSpy).toHaveBeenLastCalledWith('');
    unmount();
  });

  it('does nothing when this instance never took anything (no stash to hand off)', () => {
    const controller = makeController('chat-handoff-2');
    const { rerender, unmount } = renderHook(
      ({ skip }: { skip: boolean }) =>
        useChatThreadRuntime(controller, PORT, { active: false, chatId: 'chat-handoff-2', skipDraftRestore: skip }),
      { initialProps: { skip: true } },
    );
    rerender({ skip: false }); // takes — nothing stashed, so a no-op
    rerender({ skip: true }); // loses displayed status with nothing to hand off

    expect(takeStash('chat-handoff-2')).toBeUndefined();
    expect(setTextSpy).not.toHaveBeenCalledWith('');
    unmount();
  });
});
