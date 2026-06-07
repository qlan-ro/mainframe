import { describe, it, expect, afterEach, vi, type MockedFunction } from 'vitest';
import type { Chat } from '@qlan-ro/mainframe-types';
import type { SessionCustom } from '../../view-model/chat-to-thread-custom';

// Helper to narrow the `custom` field to our SessionCustom type in tests.
function custom(c: Record<string, unknown> | undefined): SessionCustom {
  return c as unknown as SessionCustom;
}

// ---------------------------------------------------------------------------
// Mocks — registered BEFORE any imports of the module under test
// ---------------------------------------------------------------------------

vi.mock('../../../../lib/api/chats', () => ({
  listChats: vi.fn(),
  getChat: vi.fn(),
  renameChat: vi.fn(),
  archiveChat: vi.fn(),
  unarchiveChat: vi.fn(),
}));

vi.mock('../archive-confirm-bridge', () => ({
  requestWorktreeArchiveChoice: vi.fn(),
}));

vi.mock('../new-thread-coordinator', () => ({
  createForLocal: vi.fn(),
}));

// Controller registry mock — initialize consults the per-thread controller so a
// create that already happened (onNew) is not repeated, and a create it performs
// is stamped onto the controller (so a late onNew doesn't repeat it either).
interface FakeController {
  hasRemoteId: () => boolean;
  getDaemonId: () => string;
  setRemoteId: (id: string) => void;
  setRemoteIdCalls: string[];
  remoteId: string | null;
  localId: string;
}
const fakeControllers = new Map<string, FakeController>();
function makeFakeController(localId: string, remoteId: string | null = null): FakeController {
  const ctrl: FakeController = {
    localId,
    remoteId,
    setRemoteIdCalls: [],
    hasRemoteId: () => ctrl.remoteId != null,
    getDaemonId: () => ctrl.remoteId ?? ctrl.localId,
    setRemoteId: (id: string) => {
      ctrl.setRemoteIdCalls.push(id);
      ctrl.remoteId = id;
    },
  };
  return ctrl;
}
vi.mock('../chat-controller-registry', () => ({
  chatControllerRegistry: {
    getOrCreate: (id: string) => {
      const existing = fakeControllers.get(id);
      if (existing) return existing;
      const created = makeFakeController(id, null);
      fakeControllers.set(id, created);
      return created;
    },
  },
}));

// Import AFTER mocks so the module under test picks them up.
import { makeChatsRemoteAdapter } from '../chats-remote-adapter';
import { listChats, getChat, renameChat, archiveChat, unarchiveChat } from '../../../../lib/api/chats';
import { requestWorktreeArchiveChoice } from '../archive-confirm-bridge';
import { createForLocal } from '../new-thread-coordinator';

// ---------------------------------------------------------------------------
// Typed mock helpers
// ---------------------------------------------------------------------------

const mockListChats = listChats as MockedFunction<typeof listChats>;
const mockGetChat = getChat as MockedFunction<typeof getChat>;
const mockRenameChat = renameChat as MockedFunction<typeof renameChat>;
const mockArchiveChat = archiveChat as MockedFunction<typeof archiveChat>;
const mockUnarchiveChat = unarchiveChat as MockedFunction<typeof unarchiveChat>;
const mockRequestWorktreeArchiveChoice = requestWorktreeArchiveChoice as MockedFunction<
  typeof requestWorktreeArchiveChoice
>;
const mockCreateForLocal = createForLocal as MockedFunction<typeof createForLocal>;

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

const FIXTURE: Chat = {
  id: 'chat-1',
  adapterId: 'claude',
  projectId: 'p1',
  status: 'active',
  displayStatus: 'waiting',
  createdAt: '2026-06-01T00:00:00.000Z',
  updatedAt: '2026-06-06T00:00:00.000Z',
  totalCost: 0,
  totalTokensInput: 0,
  totalTokensOutput: 0,
  lastContextTokensInput: 0,
  pinned: true,
  tags: ['backend'],
  detectedPrs: [{ number: 7, url: 'https://github.com/o/r/pull/7', owner: 'o', repo: 'r', source: 'created' as const }],
  worktreePath: '/wt/a',
};

const FIXTURE_ARCHIVED: Chat = {
  ...FIXTURE,
  status: 'archived',
};

afterEach(() => {
  vi.clearAllMocks();
  fakeControllers.clear();
});

// ---------------------------------------------------------------------------
// chats-remote-adapter — list
// ---------------------------------------------------------------------------

describe('chats-remote-adapter — list maps active chat fields via chatToThreadCustom', () => {
  it('threads[0].status is regular for an active chat', async () => {
    mockListChats.mockResolvedValueOnce([FIXTURE]);
    const adapter = makeChatsRemoteAdapter(31415);
    const result = await adapter.list();
    expect(result.threads[0]?.status).toBe('regular');
  });

  it('threads[0].remoteId equals chat.id', async () => {
    mockListChats.mockResolvedValueOnce([FIXTURE]);
    const adapter = makeChatsRemoteAdapter(31415);
    const result = await adapter.list();
    expect(result.threads[0]?.remoteId).toBe('chat-1');
  });

  it('threads[0].custom.pinned is true when chat.pinned is true', async () => {
    mockListChats.mockResolvedValueOnce([FIXTURE]);
    const adapter = makeChatsRemoteAdapter(31415);
    const result = await adapter.list();
    expect(custom(result.threads[0]?.custom).pinned).toBe(true);
  });

  it('threads[0].custom.worktreePath equals chat.worktreePath', async () => {
    mockListChats.mockResolvedValueOnce([FIXTURE]);
    const adapter = makeChatsRemoteAdapter(31415);
    const result = await adapter.list();
    expect(custom(result.threads[0]?.custom).worktreePath).toBe('/wt/a');
  });

  it('threads[0].custom.displayStatus is waiting when chat.displayStatus is waiting', async () => {
    mockListChats.mockResolvedValueOnce([FIXTURE]);
    const adapter = makeChatsRemoteAdapter(31415);
    const result = await adapter.list();
    expect(custom(result.threads[0]?.custom).displayStatus).toBe('waiting');
  });
});

describe('chats-remote-adapter — list maps archived chat status', () => {
  it('threads[0].status is archived for an archived chat', async () => {
    mockListChats.mockResolvedValueOnce([FIXTURE_ARCHIVED]);
    const adapter = makeChatsRemoteAdapter(31415);
    const result = await adapter.list();
    expect(result.threads[0]?.status).toBe('archived');
  });
});

// ---------------------------------------------------------------------------
// chats-remote-adapter — fetch
// ---------------------------------------------------------------------------

describe('chats-remote-adapter — fetch maps one chat', () => {
  it('returns remoteId chat-1', async () => {
    mockGetChat.mockResolvedValueOnce(FIXTURE);
    const adapter = makeChatsRemoteAdapter(31415);
    const result = await adapter.fetch('chat-1');
    expect(result.remoteId).toBe('chat-1');
  });

  it('returns status regular for an active chat', async () => {
    mockGetChat.mockResolvedValueOnce(FIXTURE);
    const adapter = makeChatsRemoteAdapter(31415);
    const result = await adapter.fetch('chat-1');
    expect(result.status).toBe('regular');
  });
});

// ---------------------------------------------------------------------------
// chats-remote-adapter — rename
// ---------------------------------------------------------------------------

describe('chats-remote-adapter — rename calls renameChat once with correct args', () => {
  it('calls renameChat(31415, chat-1, New title) exactly once', async () => {
    mockRenameChat.mockResolvedValueOnce(FIXTURE);
    const adapter = makeChatsRemoteAdapter(31415);
    await adapter.rename('chat-1', 'New title');
    expect(mockRenameChat).toHaveBeenCalledTimes(1);
    expect(mockRenameChat).toHaveBeenCalledWith(31415, 'chat-1', 'New title');
  });
});

// ---------------------------------------------------------------------------
// chats-remote-adapter — unarchive
// ---------------------------------------------------------------------------

describe('chats-remote-adapter — unarchive calls unarchiveChat once', () => {
  it('calls unarchiveChat(31415, chat-1) exactly once', async () => {
    mockUnarchiveChat.mockResolvedValueOnce(FIXTURE);
    const adapter = makeChatsRemoteAdapter(31415);
    await adapter.unarchive('chat-1');
    expect(mockUnarchiveChat).toHaveBeenCalledTimes(1);
    expect(mockUnarchiveChat).toHaveBeenCalledWith(31415, 'chat-1');
  });
});

// ---------------------------------------------------------------------------
// chats-remote-adapter — archive awaits bridge then archives
// ---------------------------------------------------------------------------

describe('chats-remote-adapter — archive awaits bridge then calls archiveChat', () => {
  it('calls requestWorktreeArchiveChoice with hasWorktree:true when worktreePath is present', async () => {
    mockGetChat.mockResolvedValueOnce(FIXTURE);
    mockRequestWorktreeArchiveChoice.mockResolvedValueOnce({ deleteWorktree: false });
    mockArchiveChat.mockResolvedValueOnce(undefined);
    const adapter = makeChatsRemoteAdapter(31415);
    await adapter.archive('chat-1');
    expect(mockRequestWorktreeArchiveChoice).toHaveBeenCalledWith('chat-1', { hasWorktree: true });
  });

  it('calls archiveChat(31415, chat-1, false) when deleteWorktree is false', async () => {
    mockGetChat.mockResolvedValueOnce(FIXTURE);
    mockRequestWorktreeArchiveChoice.mockResolvedValueOnce({ deleteWorktree: false });
    mockArchiveChat.mockResolvedValueOnce(undefined);
    const adapter = makeChatsRemoteAdapter(31415);
    await adapter.archive('chat-1');
    expect(mockArchiveChat).toHaveBeenCalledTimes(1);
    expect(mockArchiveChat).toHaveBeenCalledWith(31415, 'chat-1', false);
  });
});

// ---------------------------------------------------------------------------
// chats-remote-adapter — archive cancel throws and does NOT call archiveChat
// ---------------------------------------------------------------------------

describe('chats-remote-adapter — archive cancel throws and does not archive', () => {
  it('rejects when requestWorktreeArchiveChoice resolves cancel', async () => {
    mockGetChat.mockResolvedValueOnce(FIXTURE);
    mockRequestWorktreeArchiveChoice.mockResolvedValueOnce('cancel');
    const adapter = makeChatsRemoteAdapter(31415);
    await expect(adapter.archive('chat-1')).rejects.toThrow();
  });

  it('does not call archiveChat when cancel is chosen', async () => {
    mockGetChat.mockResolvedValueOnce(FIXTURE);
    mockRequestWorktreeArchiveChoice.mockResolvedValueOnce('cancel');
    const adapter = makeChatsRemoteAdapter(31415);
    await expect(adapter.archive('chat-1')).rejects.toThrow();
    expect(mockArchiveChat).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// chats-remote-adapter — delete maps to archive (calls archiveChat with deleteWorktree:true)
// ---------------------------------------------------------------------------

describe('chats-remote-adapter — delete maps to archiveChat with deleteWorktree:true', () => {
  it('calls archiveChat(31415, chat-1, true) when deleteWorktree is true', async () => {
    mockGetChat.mockResolvedValueOnce(FIXTURE);
    mockRequestWorktreeArchiveChoice.mockResolvedValueOnce({ deleteWorktree: true });
    mockArchiveChat.mockResolvedValueOnce(undefined);
    const adapter = makeChatsRemoteAdapter(31415);
    await adapter.delete('chat-1');
    expect(mockArchiveChat).toHaveBeenCalledTimes(1);
    expect(mockArchiveChat).toHaveBeenCalledWith(31415, 'chat-1', true);
  });
});

// ---------------------------------------------------------------------------
// chats-remote-adapter — generateTitle returns empty ReadableStream
// ---------------------------------------------------------------------------

describe('chats-remote-adapter — generateTitle returns an empty ReadableStream', () => {
  it('result is an instance of ReadableStream', async () => {
    const adapter = makeChatsRemoteAdapter(31415);
    const result = await adapter.generateTitle('chat-1', []);
    expect(result).toBeInstanceOf(ReadableStream);
  });

  it('does not call renameChat or archiveChat', async () => {
    const adapter = makeChatsRemoteAdapter(31415);
    await adapter.generateTitle('chat-1', []);
    expect(mockRenameChat).not.toHaveBeenCalled();
    expect(mockArchiveChat).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// chats-remote-adapter — initialize returns coordinator's id
// ---------------------------------------------------------------------------

describe('chats-remote-adapter — initialize returns the coordinator remoteId', () => {
  it('returns { remoteId: chat-77, externalId: undefined }', async () => {
    mockCreateForLocal.mockResolvedValueOnce({ remoteId: 'chat-77' });
    const adapter = makeChatsRemoteAdapter(31415);
    const result = await adapter.initialize('__LOCALID_z');
    expect(result).toEqual({ remoteId: 'chat-77', externalId: undefined });
  });

  it('calls createForLocal(__LOCALID_z, 31415) exactly once', async () => {
    mockCreateForLocal.mockResolvedValueOnce({ remoteId: 'chat-77' });
    const adapter = makeChatsRemoteAdapter(31415);
    await adapter.initialize('__LOCALID_z');
    expect(mockCreateForLocal).toHaveBeenCalledTimes(1);
    expect(mockCreateForLocal).toHaveBeenCalledWith('__LOCALID_z', 31415);
  });
});

// ---------------------------------------------------------------------------
// chats-remote-adapter — initialize is idempotent against onNew (HIGH-1 race)
//
// Both create seams fire on first send: our onNew AND aui's initialize. onNew
// completing first (the real DOM-driven ordering) settles the coordinator and
// clears the draft, so a LATER initialize must NOT re-create (no second POST,
// no "no draft" throw). It consults the per-thread controller instead.
// ---------------------------------------------------------------------------

describe('chats-remote-adapter — initialize is idempotent with onNew', () => {
  it('returns the controller remoteId WITHOUT calling createForLocal when onNew already created it', async () => {
    // onNew already created + adopted the chat — the controller carries the id.
    fakeControllers.set('__LOCALID_z', makeFakeController('__LOCALID_z', 'chat-77'));

    const adapter = makeChatsRemoteAdapter(31415);
    const result = await adapter.initialize('__LOCALID_z');

    expect(result).toEqual({ remoteId: 'chat-77', externalId: undefined });
    expect(mockCreateForLocal).not.toHaveBeenCalled();
  });

  it('stamps the controller when IT performs the create (so a later onNew skips creating)', async () => {
    // No remote id yet — initialize is the seam that creates.
    mockCreateForLocal.mockResolvedValueOnce({ remoteId: 'chat-77' });

    const adapter = makeChatsRemoteAdapter(31415);
    await adapter.initialize('__LOCALID_z');

    const ctrl = fakeControllers.get('__LOCALID_z');
    expect(ctrl?.setRemoteIdCalls).toEqual(['chat-77']);
  });
});
