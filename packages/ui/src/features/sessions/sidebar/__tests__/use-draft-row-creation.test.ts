// @vitest-environment jsdom
import { useEffect } from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Chat } from '@qlan-ro/mainframe-types';
import { getDraftConfig, setDraftConfig, useDraftConfigStore } from '../../runtime/draft-config';
import { createForLocal, abandonCreateForLocal } from '../../runtime/new-thread-coordinator';
import { useDraftReturnTarget } from '../../new-thread/use-draft-return-target';
import { resetNewThreadDraft } from '../../new-thread/reset-new-thread-draft';
import { archiveChat, createChat, discardChat, setChatTuning } from '../../../../lib/api/chats';
import { useDraftRow } from '../use-draft-row';

const localId = '__LOCALID_creation';
let mainThreadId = localId;
let newThreadId: string | null = localId;
vi.mock('@assistant-ui/react', () => ({
  useAui: () => ({ threads: { switchToThread: vi.fn() } }),
  useAuiState: (selector: (state: unknown) => unknown) => selector({ threads: { mainThreadId, newThreadId } }),
}));
vi.mock('../../../../lib/api/chats', () => ({
  createChat: vi.fn(),
  setChatTuning: vi.fn(),
  setChatConfig: vi.fn().mockResolvedValue(undefined),
  archiveChat: vi.fn().mockResolvedValue(undefined),
  discardChat: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../new-thread/reset-new-thread-draft', async (original) => {
  const actual = await original<typeof import('../../new-thread/reset-new-thread-draft')>();
  return { resetNewThreadDraft: vi.fn(actual.resetNewThreadDraft) };
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function configure(id = localId, temporary = false) {
  setDraftConfig(id, {
    projectId: 'project',
    adapterId: 'claude',
    model: 'default',
    permissionMode: 'default',
    planMode: false,
    effort: null,
    fast: false,
    ultracode: false,
    adaptiveThinking: false,
    temporary,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(createChat).mockResolvedValue({ id: 'chat-created' } as Chat);
  vi.mocked(setChatTuning).mockResolvedValue(undefined as unknown as Chat);
  mainThreadId = localId;
  newThreadId = localId;
  configure();
  useDraftReturnTarget.getState().setReturnTarget('chat-before');
});
afterEach(() => {
  cleanup();
  abandonCreateForLocal(localId);
  abandonCreateForLocal('__LOCALID_replacement');
  useDraftConfigStore.setState({ drafts: new Map() });
  useDraftReturnTarget.getState().clear();
});

it.each(['create', 'tuning'] as const)(
  'preserves first-send ownership while %s is pending and identity changes',
  async (stage) => {
    const response = deferred<Chat>();
    vi.mocked(stage === 'create' ? createChat : setChatTuning).mockReturnValueOnce(response.promise);
    const { rerender } = renderHook(() => useDraftRow([], new Set()));
    let pending!: Promise<unknown>;
    await act(async () => {
      pending = createForLocal(localId, 31415).catch((error: unknown) => error);
    });
    mainThreadId = 'chat-created';
    rerender();
    const resetsBeforeSettlement = vi.mocked(resetNewThreadDraft).mock.calls.length;
    await act(async () => {
      response.resolve({ id: 'chat-created' } as Chat);
      await pending;
    });
    expect(resetsBeforeSettlement).toBe(0);
    await expect(pending).resolves.toEqual({ remoteId: 'chat-created' });
    expect(archiveChat).not.toHaveBeenCalled();
    expect(discardChat).not.toHaveBeenCalled();
    expect(getDraftConfig(localId)).toBeUndefined();
    expect(useDraftReturnTarget.getState().returnThreadId).toBeNull();
  },
);

it('does not transfer selection history to a replacement slot', () => {
  const { rerender } = renderHook(() => useDraftRow([], new Set()));
  act(() => {
    configure('__LOCALID_replacement');
  });
  newThreadId = '__LOCALID_replacement';
  mainThreadId = 'chat-other';
  rerender();
  expect(getDraftConfig('__LOCALID_replacement')).toBeDefined();
  expect(resetNewThreadDraft).not.toHaveBeenCalledWith('__LOCALID_replacement');
});

it('accepts configuration-first commit ordering before the identity change', async () => {
  const { rerender } = renderHook(() => useDraftRow([], new Set()));
  await act(async () => {
    await createForLocal(localId, 31415);
  });
  mainThreadId = 'chat-created';
  rerender();
  expect(resetNewThreadDraft).not.toHaveBeenCalled();
  expect(archiveChat).not.toHaveBeenCalled();
});

it.each([false, true])('cleans a failed navigated-away attempt once, temporary=%s', async (temporary) => {
  configure(localId, temporary);
  const response = deferred<Chat>();
  vi.mocked(setChatTuning).mockReturnValueOnce(response.promise);
  const { rerender } = renderHook(() => useDraftRow([], new Set()));
  let pending!: Promise<unknown>;
  await act(async () => {
    pending = createForLocal(localId, 31415).catch((error: unknown) => error);
  });
  mainThreadId = 'chat-other';
  rerender();
  expect(resetNewThreadDraft).not.toHaveBeenCalled();
  await act(async () => {
    response.reject(new Error('tuning failed'));
    await pending;
  });
  expect(getDraftConfig(localId)).toBeUndefined();
  expect(resetNewThreadDraft).toHaveBeenCalledTimes(1);
  expect(temporary ? discardChat : archiveChat).toHaveBeenCalledTimes(1);
  expect(temporary ? archiveChat : discardChat).not.toHaveBeenCalled();
});

it('retains a selected failed attempt for retry without creating another chat', async () => {
  vi.mocked(setChatTuning).mockRejectedValueOnce(new Error('tuning failed'));
  renderHook(() => useDraftRow([], new Set()));
  await act(async () => {
    await expect(createForLocal(localId, 31415)).rejects.toThrow('tuning failed');
  });
  expect(getDraftConfig(localId)).toBeDefined();
  await act(async () => {
    await expect(createForLocal(localId, 31415)).resolves.toEqual({ remoteId: 'chat-created' });
  });
  expect(createChat).toHaveBeenCalledTimes(1);
  expect(resetNewThreadDraft).not.toHaveBeenCalled();
});

it.each([false, true])('allows explicit discard during creation, temporary=%s', async (temporary) => {
  configure(localId, temporary);
  const response = deferred<Chat>();
  vi.mocked(createChat).mockReturnValueOnce(response.promise);
  const { result } = renderHook(() => useDraftRow([], new Set()));
  let pending!: Promise<unknown>;
  await act(async () => {
    pending = createForLocal(localId, 31415).catch((error: unknown) => error);
  });
  act(() => {
    result.current.onDiscard();
  });
  expect(getDraftConfig(localId)).toBeUndefined();
  await act(async () => {
    response.resolve({ id: 'chat-created' } as Chat);
    await pending;
  });
  expect(temporary ? discardChat : archiveChat).toHaveBeenCalledTimes(1);
  expect(temporary ? archiveChat : discardChat).not.toHaveBeenCalled();
});

it('retires selection on reset even when the same local id is recycled in one batch', () => {
  const { rerender } = renderHook(() => useDraftRow([], new Set()));
  act(() => {
    resetNewThreadDraft(localId);
    configure();
    mainThreadId = 'chat-before';
  });
  vi.mocked(resetNewThreadDraft).mockClear();
  rerender();
  expect(getDraftConfig(localId)).toBeDefined();
  expect(resetNewThreadDraft).not.toHaveBeenCalled();
});

it('ignores a stale configured render after another effect commits the draft', () => {
  const { rerender } = renderHook(() => {
    useEffect(() => {
      if (mainThreadId === 'chat-created') useDraftConfigStore.getState().clearDraft(localId);
    }, [mainThreadId]);
    return useDraftRow([], new Set());
  });
  mainThreadId = 'chat-created';
  rerender();
  expect(resetNewThreadDraft).not.toHaveBeenCalled();
});

it('settles create failure after navigation without another identity change', async () => {
  const response = deferred<Chat>();
  vi.mocked(createChat).mockReturnValueOnce(response.promise);
  const { rerender } = renderHook(() => useDraftRow([], new Set()));
  let pending!: Promise<unknown>;
  await act(async () => {
    pending = createForLocal(localId, 31415).catch((error: unknown) => error);
  });
  mainThreadId = 'chat-other';
  rerender();
  expect(getDraftConfig(localId)).toBeDefined();
  await act(async () => {
    response.reject(new Error('create failed'));
    await pending;
  });
  expect(getDraftConfig(localId)).toBeUndefined();
  expect(resetNewThreadDraft).toHaveBeenCalledTimes(1);
  expect(archiveChat).not.toHaveBeenCalled();
});

it('preserves a pending creation when the native new-thread slot changes', async () => {
  const response = deferred<Chat>();
  vi.mocked(createChat).mockReturnValueOnce(response.promise);
  const { rerender } = renderHook(() => useDraftRow([], new Set()));
  let pending!: Promise<unknown>;
  await act(async () => {
    pending = createForLocal(localId, 31415);
  });
  act(() => {
    configure('__LOCALID_replacement');
  });
  newThreadId = '__LOCALID_replacement';
  mainThreadId = 'chat-created';
  rerender();
  expect(resetNewThreadDraft).not.toHaveBeenCalled();
  await act(async () => {
    response.resolve({ id: 'chat-created' } as Chat);
    await pending;
  });
  expect(getDraftConfig('__LOCALID_replacement')).toBeDefined();
  expect(archiveChat).not.toHaveBeenCalled();
});
