import { describe, it, expect, afterEach, vi, type MockedFunction } from 'vitest';
import type { Chat } from '@qlan-ro/mainframe-types';
import { setDraftConfig, clearDraftConfig } from '../draft-config';

// ---------------------------------------------------------------------------
// Mock createChat, setChatTuning, setChatConfig — no HTTP calls
// ---------------------------------------------------------------------------

vi.mock('../../../../lib/api/chats', () => ({
  createChat: vi.fn(),
  setChatTuning: vi.fn().mockResolvedValue(undefined),
  setChatConfig: vi.fn().mockResolvedValue(undefined),
}));

// Mock the ready-store so we can assert the first-send cleanup without a real store.
const clearReadySpy = vi.fn();
vi.mock('../new-thread-ready-store', () => ({
  useNewThreadReady: {
    getState: () => ({ clearReady: (...args: unknown[]) => clearReadySpy(...args) }),
  },
}));

// Mock enableWorktree (pendingWorktree carry) and the toast raised on its failure.
vi.mock('../../../../lib/api/git', () => ({
  enableWorktree: vi.fn().mockResolvedValue(undefined),
}));
const toastErrorSpy = vi.fn();
vi.mock('../../../../lib/toast', () => ({
  mfToast: { error: (...args: unknown[]) => toastErrorSpy(...args) },
}));

// Import AFTER the mock is registered so the module under test picks up the mock.
import { createForLocal } from '../new-thread-coordinator';
import { createChat, setChatTuning, setChatConfig } from '../../../../lib/api/chats';
import { enableWorktree } from '../../../../lib/api/git';

const mockCreateChat = createChat as MockedFunction<typeof createChat>;
const mockSetChatTuning = setChatTuning as MockedFunction<typeof setChatTuning>;
const mockSetChatConfig = setChatConfig as MockedFunction<typeof setChatConfig>;
const mockEnableWorktree = enableWorktree as MockedFunction<typeof enableWorktree>;

// ---------------------------------------------------------------------------
// Reset draft-config singleton state + mock call counts between cases
// ---------------------------------------------------------------------------

afterEach(() => {
  clearDraftConfig('__LOCALID_a');
  clearDraftConfig('__LOCALID_b');
  clearDraftConfig('__LOCALID_c');
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// new-thread-coordinator — createForLocal
// ---------------------------------------------------------------------------

describe('new-thread-coordinator — happy path calls createChat with required fields', () => {
  it('calls createChat exactly once with the required draft fields', async () => {
    setDraftConfig('__LOCALID_a', {
      projectId: 'p1',
      adapterId: 'claude',
      permissionMode: 'default',
    });
    mockCreateChat.mockResolvedValueOnce({ id: 'chat-99' } as Chat);

    await createForLocal('__LOCALID_a', 31415);

    expect(mockCreateChat).toHaveBeenCalledTimes(1);
    expect(mockCreateChat).toHaveBeenCalledWith(31415, {
      projectId: 'p1',
      adapterId: 'claude',
      permissionMode: 'default',
    });
  });

  it('resolves to { remoteId: chat-99 } when createChat returns { id: chat-99 }', async () => {
    setDraftConfig('__LOCALID_a', {
      projectId: 'p1',
      adapterId: 'claude',
      permissionMode: 'default',
    });
    mockCreateChat.mockResolvedValueOnce({ id: 'chat-99' } as Chat);

    const result = await createForLocal('__LOCALID_a', 31415);

    expect(result).toEqual({ remoteId: 'chat-99' });
  });
});

it('passes optional fields (model, worktreePath, branchName) to createChat when set in the draft', async () => {
  setDraftConfig('__LOCALID_a', {
    projectId: 'p2',
    adapterId: 'codex',
    model: 'gpt-5',
    permissionMode: 'plan',
    worktreePath: '/wt/feat',
    branchName: 'feat/x',
  });
  mockCreateChat.mockResolvedValueOnce({ id: 'chat-77' } as Chat);

  await createForLocal('__LOCALID_a', 31415);

  expect(mockCreateChat).toHaveBeenCalledWith(31415, {
    projectId: 'p2',
    adapterId: 'codex',
    model: 'gpt-5',
    permissionMode: 'plan',
    worktreePath: '/wt/feat',
    branchName: 'feat/x',
  });
});

describe('new-thread-coordinator — POST failure propagates and preserves draft', () => {
  it('rejects with the original error message when createChat rejects', async () => {
    setDraftConfig('__LOCALID_a', {
      projectId: 'p1',
      adapterId: 'claude',
      permissionMode: 'default',
    });
    mockCreateChat.mockRejectedValueOnce(new Error('create failed'));

    await expect(createForLocal('__LOCALID_a', 31415)).rejects.toThrow('create failed');
  });

  it('leaves the draft config intact after a POST failure (so the user can retry)', async () => {
    setDraftConfig('__LOCALID_a', {
      projectId: 'p1',
      adapterId: 'claude',
      permissionMode: 'default',
    });
    mockCreateChat.mockRejectedValueOnce(new Error('create failed'));

    await expect(createForLocal('__LOCALID_a', 31415)).rejects.toThrow('create failed');

    // The draft must survive the failure so the caller can retry.
    mockCreateChat.mockResolvedValueOnce({ id: 'chat-99' } as Chat);
    const retry = await createForLocal('__LOCALID_a', 31415);
    expect(retry).toEqual({ remoteId: 'chat-99' });
  });
});

describe('new-thread-coordinator — missing draft rejects without calling createChat', () => {
  it('rejects with an error matching /draft/i when no draft config is present', async () => {
    await expect(createForLocal('__LOCALID_missing', 31415)).rejects.toThrow(/draft/i);
  });

  it('does not call createChat when no draft exists', async () => {
    await expect(createForLocal('__LOCALID_missing', 31415)).rejects.toThrow(/draft/i);
    expect(mockCreateChat).not.toHaveBeenCalled();
  });
});

describe('new-thread-coordinator — clears the new-thread-ready flag on first send', () => {
  it('clears the ready flag for the local id on a successful create', async () => {
    setDraftConfig('__LOCALID_a', {
      projectId: 'p1',
      adapterId: 'claude',
      permissionMode: 'default',
    });
    mockCreateChat.mockResolvedValueOnce({ id: 'chat-99' } as Chat);

    await createForLocal('__LOCALID_a', 31415);

    expect(clearReadySpy).toHaveBeenCalledWith('__LOCALID_a');
  });

  it('does NOT clear the ready flag when the create fails (so retry still shows the composer)', async () => {
    setDraftConfig('__LOCALID_a', {
      projectId: 'p1',
      adapterId: 'claude',
      permissionMode: 'default',
    });
    mockCreateChat.mockRejectedValueOnce(new Error('create failed'));

    await expect(createForLocal('__LOCALID_a', 31415)).rejects.toThrow('create failed');

    expect(clearReadySpy).not.toHaveBeenCalled();
  });
});

it('calls setChatTuning with effort/fast and setChatConfig with planMode when the draft has tuning fields', async () => {
  setDraftConfig('__LOCALID_a', {
    projectId: 'p1',
    adapterId: 'claude',
    permissionMode: 'default',
    effort: 'high',
    fast: true,
    planMode: true,
  });
  mockCreateChat.mockResolvedValueOnce({ id: 'chat-42' } as Chat);
  mockSetChatTuning.mockResolvedValueOnce(undefined as unknown as Chat);
  mockSetChatConfig.mockResolvedValueOnce(undefined as unknown as Chat);

  await createForLocal('__LOCALID_a', 31415);

  expect(mockSetChatTuning).toHaveBeenCalledExactlyOnceWith(31415, 'chat-42', {
    effort: 'high',
    fast: true,
  });
  expect(mockSetChatConfig).toHaveBeenCalledExactlyOnceWith(31415, 'chat-42', { planMode: true });
});

it('does NOT call setChatTuning or setChatConfig when the draft has only base fields (no tuning)', async () => {
  setDraftConfig('__LOCALID_a', {
    projectId: 'p1',
    adapterId: 'claude',
    permissionMode: 'default',
  });
  mockCreateChat.mockResolvedValueOnce({ id: 'chat-43' } as Chat);

  await createForLocal('__LOCALID_a', 31415);

  expect(mockSetChatTuning).not.toHaveBeenCalled();
  expect(mockSetChatConfig).not.toHaveBeenCalled();
});

it('still resolves to {remoteId} even when setChatTuning rejects (the tuning hiccup is swallowed)', async () => {
  setDraftConfig('__LOCALID_a', {
    projectId: 'p1',
    adapterId: 'claude',
    permissionMode: 'default',
    effort: 'medium',
  });
  mockCreateChat.mockResolvedValueOnce({ id: 'chat-44' } as Chat);
  mockSetChatTuning.mockRejectedValueOnce(new Error('tuning failed'));

  const result = await createForLocal('__LOCALID_a', 31415);

  expect(result).toEqual({ remoteId: 'chat-44' });
});

// ---------------------------------------------------------------------------
// permissionMode omission fix — the key behaviour this covers
// ---------------------------------------------------------------------------

describe('new-thread-coordinator — permissionMode omission fix', () => {
  it('omits permissionMode from the createChat body when the draft has none', async () => {
    setDraftConfig('__LOCALID_b', { projectId: 'p1', adapterId: 'claude' });
    mockCreateChat.mockResolvedValueOnce({ id: 'chat-1' } as Chat);

    await createForLocal('__LOCALID_b', 31415);

    const body = mockCreateChat.mock.calls[0]![1];
    expect('permissionMode' in body).toBe(false);
    expect(body).toMatchObject({ projectId: 'p1', adapterId: 'claude' });
  });

  it('includes permissionMode in the createChat body when the draft set one', async () => {
    setDraftConfig('__LOCALID_c', {
      projectId: 'p1',
      adapterId: 'claude',
      permissionMode: 'yolo',
    });
    mockCreateChat.mockResolvedValueOnce({ id: 'chat-1' } as Chat);

    await createForLocal('__LOCALID_c', 31415);

    const body = mockCreateChat.mock.calls[0]![1];
    expect(body.permissionMode).toBe('yolo');
  });

  it('returns { remoteId } equal to the id of the created chat', async () => {
    setDraftConfig('__LOCALID_b', { projectId: 'p1', adapterId: 'claude' });
    mockCreateChat.mockResolvedValueOnce({ id: 'chat-1' } as Chat);

    const result = await createForLocal('__LOCALID_b', 31415);

    expect(result).toEqual({ remoteId: 'chat-1' });
  });
});

// ---------------------------------------------------------------------------
// pendingWorktree — a "New" worktree chosen pre-send is created right after
// the chat (enable-worktree is chat-scoped, so it can't run on a draft)
// ---------------------------------------------------------------------------

describe('new-thread-coordinator — pendingWorktree is created right after the chat', () => {
  it('calls enableWorktree(port, chatId, baseBranch, branchName) and omits pendingWorktree from the createChat body', async () => {
    setDraftConfig('__LOCALID_a', {
      projectId: 'p1',
      adapterId: 'claude',
      pendingWorktree: { baseBranch: 'main', branchName: 'feat/new' },
    });
    mockCreateChat.mockResolvedValueOnce({ id: 'chat-55' } as Chat);

    const result = await createForLocal('__LOCALID_a', 31415);

    expect(result).toEqual({ remoteId: 'chat-55' });
    expect(mockEnableWorktree).toHaveBeenCalledExactlyOnceWith(31415, 'chat-55', 'main', 'feat/new');
    const body = mockCreateChat.mock.calls[0]![1];
    expect('pendingWorktree' in body).toBe(false);
  });

  it('does NOT call enableWorktree when the draft has no pendingWorktree', async () => {
    setDraftConfig('__LOCALID_a', { projectId: 'p1', adapterId: 'claude' });
    mockCreateChat.mockResolvedValueOnce({ id: 'chat-56' } as Chat);

    await createForLocal('__LOCALID_a', 31415);

    expect(mockEnableWorktree).not.toHaveBeenCalled();
  });

  it('still resolves and raises an error toast when enableWorktree fails (session falls back to the main repo)', async () => {
    setDraftConfig('__LOCALID_a', {
      projectId: 'p1',
      adapterId: 'claude',
      pendingWorktree: { baseBranch: 'main', branchName: 'feat/new' },
    });
    mockCreateChat.mockResolvedValueOnce({ id: 'chat-57' } as Chat);
    mockEnableWorktree.mockRejectedValueOnce(new Error('branch exists'));

    const result = await createForLocal('__LOCALID_a', 31415);

    expect(result).toEqual({ remoteId: 'chat-57' });
    expect(toastErrorSpy).toHaveBeenCalled();
  });
});
