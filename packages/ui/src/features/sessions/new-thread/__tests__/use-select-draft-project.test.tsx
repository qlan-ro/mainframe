/**
 * useSelectDraftProject — behavior tests.
 *
 * The welcome screen's picker re-scopes the CURRENT draft: reset the reused
 * slot, then initialize it for the picked project. It is NOT the full
 * openNewThreadDraft sequence — no thread switch and no return-target write, so
 * "cancel" still routes back to the previous session.
 *
 * initializeDraft, resetNewThreadDraft, the toast and the filter store are
 * mocked; each is asserted by the exact call it receives.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

let __newThreadId: string | null = '__LOCALID_1';
let __mainThreadId: string | null = 'chat-7';
let __filterProjectIds: Set<string> = new Set();
let __initError: Error | null = null;

const baseInitialize = async (_args: unknown) => {
  if (__initError) throw __initError;
  return { projectId: 'proj-b', adapterId: 'claude' };
};

const switchToNewThread = vi.fn();
const clearProjectFilter = vi.fn();
const resetNewThreadDraft = vi.fn((_newThreadId: string | null | undefined) => undefined);
const initializeDraft = vi.fn(baseInitialize);
const toastError = vi.fn((_message: string, _options?: { description: string }) => undefined);

vi.mock('@assistant-ui/react', () => ({
  useAui: () => ({
    threads: {
      getState: () => ({ newThreadId: __newThreadId, mainThreadId: __mainThreadId }),
      switchToNewThread,
    },
  }),
}));
vi.mock('@/lib/toast', () => ({
  mfToast: { error: (message: string, options?: { description: string }) => toastError(message, options) },
}));
vi.mock('@/features/sessions/runtime/daemon-port-context', () => ({ useDaemonPort: () => 31415 }));
vi.mock('@/store/session-filters', () => ({
  useSessionFilters: (selector: (s: unknown) => unknown) =>
    selector({ filterProjectIds: __filterProjectIds, clearProjectFilter }),
}));
vi.mock('@/store/settings', () => ({
  useSettingsStore: (selector: (s: unknown) => unknown) => selector({ general: { defaultAdapterId: 'gemini' } }),
}));
vi.mock('@/store/adapters', () => ({ useAdapters: () => [{ id: 'gemini', installed: true }] }));
vi.mock('../initialize-draft', () => ({ initializeDraft: (args: unknown) => initializeDraft(args) }));
vi.mock('../reset-new-thread-draft', () => ({
  resetNewThreadDraft: (newThreadId: string | null | undefined) => resetNewThreadDraft(newThreadId),
}));

import { useSelectDraftProject } from '../use-select-draft-project';

const select = () => renderHook(() => useSelectDraftProject()).result.current;

beforeEach(() => {
  __newThreadId = '__LOCALID_1';
  __mainThreadId = 'chat-7';
  __filterProjectIds = new Set();
  __initError = null;
  switchToNewThread.mockReset();
  clearProjectFilter.mockReset();
  resetNewThreadDraft.mockReset();
  initializeDraft.mockReset();
  initializeDraft.mockImplementation(baseInitialize);
  toastError.mockReset();
});

describe('useSelectDraftProject', () => {
  it('resets the reused draft slot and initializes it for the picked project', async () => {
    await select()('proj-b');

    expect(resetNewThreadDraft).toHaveBeenCalledExactlyOnceWith('__LOCALID_1');
    expect(initializeDraft).toHaveBeenCalledExactlyOnceWith({
      localId: '__LOCALID_1',
      projectId: 'proj-b',
      port: 31415,
      defaultAdapterId: 'gemini',
      adapters: [{ id: 'gemini', installed: true }],
    });
  });

  it('resets before initializing, so the fresh config is not cleared again', async () => {
    const order: string[] = [];
    resetNewThreadDraft.mockImplementation(() => void order.push('reset'));
    initializeDraft.mockImplementation(async (args: unknown) => {
      order.push('initialize');
      return baseInitialize(args);
    });

    await select()('proj-b');

    expect(order).toEqual(['reset', 'initialize']);
  });

  it('does not switch threads — the draft is already the active one', async () => {
    await select()('proj-b');

    expect(switchToNewThread).not.toHaveBeenCalled();
  });

  it('falls back to the main thread id when no new-thread slot is allocated', async () => {
    __newThreadId = null;
    __mainThreadId = '__LOCALID_9';

    await select()('proj-b');

    expect(resetNewThreadDraft).toHaveBeenCalledExactlyOnceWith(null);
    expect(initializeDraft).toHaveBeenCalledExactlyOnceWith({
      localId: '__LOCALID_9',
      projectId: 'proj-b',
      port: 31415,
      defaultAdapterId: 'gemini',
      adapters: [{ id: 'gemini', installed: true }],
    });
  });

  it('does nothing when there is no thread to scope', async () => {
    __newThreadId = null;
    __mainThreadId = null;
    __filterProjectIds = new Set(['proj-a']);

    await select()('proj-b');

    expect(resetNewThreadDraft).not.toHaveBeenCalled();
    expect(initializeDraft).not.toHaveBeenCalled();
    expect(clearProjectFilter).not.toHaveBeenCalled();
  });

  it('clears a project filter that points somewhere else', async () => {
    __filterProjectIds = new Set(['proj-a']);

    await select()('proj-b');

    expect(clearProjectFilter).toHaveBeenCalledExactlyOnceWith();
  });

  it('keeps a project filter that already points at the picked project', async () => {
    __filterProjectIds = new Set(['proj-b']);

    await select()('proj-b');

    expect(clearProjectFilter).not.toHaveBeenCalled();
  });

  it('does not clear when the picked project is among several scoped projects', async () => {
    __filterProjectIds = new Set(['proj-a', 'proj-b']);

    await select()('proj-b');

    expect(clearProjectFilter).not.toHaveBeenCalled();
  });

  it('leaves the "All projects" view alone', async () => {
    __filterProjectIds = new Set();

    await select()('proj-b');

    expect(clearProjectFilter).not.toHaveBeenCalled();
  });

  it('toasts and resolves when initialization fails', async () => {
    __initError = new Error('daemon unreachable');

    await expect(select()('proj-b')).resolves.toBeUndefined();

    expect(toastError).toHaveBeenCalledExactlyOnceWith('Couldn’t initialize session', {
      description: 'daemon unreachable',
    });
  });

  it('stringifies a non-Error rejection into the toast description', async () => {
    __initError = 'no adapters' as unknown as Error;

    await select()('proj-b');

    expect(toastError).toHaveBeenCalledExactlyOnceWith('Couldn’t initialize session', {
      description: 'no adapters',
    });
  });
});
