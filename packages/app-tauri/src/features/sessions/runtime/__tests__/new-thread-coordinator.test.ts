import { describe, it, expect, afterEach, vi, type MockedFunction } from 'vitest';
import type { Chat } from '@qlan-ro/mainframe-types';
import { setDraftConfig, clearDraftConfig } from '../draft-config';

// ---------------------------------------------------------------------------
// Mock createChat — no HTTP calls
// ---------------------------------------------------------------------------

vi.mock('../../../../lib/api/chats', () => ({
  createChat: vi.fn(),
}));

// Import AFTER the mock is registered so the module under test picks up the mock.
import { createForLocal } from '../new-thread-coordinator';
import { createChat } from '../../../../lib/api/chats';

const mockCreateChat = createChat as MockedFunction<typeof createChat>;

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
