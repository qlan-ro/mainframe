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

// Import AFTER the mock is registered so the module under test picks up the mock.
import { createForLocal } from '../new-thread-coordinator';
import { createChat, setChatTuning, setChatConfig } from '../../../../lib/api/chats';

const mockCreateChat = createChat as MockedFunction<typeof createChat>;
const mockSetChatTuning = setChatTuning as MockedFunction<typeof setChatTuning>;
const mockSetChatConfig = setChatConfig as MockedFunction<typeof setChatConfig>;

// ---------------------------------------------------------------------------
// Reset draft-config singleton state + mock call counts between cases
// ---------------------------------------------------------------------------

afterEach(() => {
  clearDraftConfig('__LOCALID_a');
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

describe('new-thread-coordinator — optional fields are forwarded when present', () => {
  it('passes model, worktreePath and branchName to createChat when set in the draft', async () => {
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

// ---------------------------------------------------------------------------
// Draft tuning fields — applyDraftTuning called post-create
// ---------------------------------------------------------------------------

describe('new-thread-coordinator — draft with tuning calls setChatTuning and setChatConfig', () => {
  it('calls setChatTuning with effort and setChatConfig with planMode', async () => {
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
});

describe('new-thread-coordinator — draft with no tuning fields calls neither setChatTuning nor setChatConfig', () => {
  it('does NOT call setChatTuning or setChatConfig when the draft has only base fields', async () => {
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
});

describe('new-thread-coordinator — setChatTuning rejection does NOT reject createForLocal', () => {
  it('still resolves to {remoteId} even when setChatTuning rejects', async () => {
    setDraftConfig('__LOCALID_a', {
      projectId: 'p1',
      adapterId: 'claude',
      permissionMode: 'default',
      effort: 'medium',
    });
    mockCreateChat.mockResolvedValueOnce({ id: 'chat-44' } as Chat);
    mockSetChatTuning.mockRejectedValueOnce(new Error('tuning failed'));

    // The tuning hiccup is swallowed; createForLocal still resolves.
    const result = await createForLocal('__LOCALID_a', 31415);

    expect(result).toEqual({ remoteId: 'chat-44' });
  });
});
