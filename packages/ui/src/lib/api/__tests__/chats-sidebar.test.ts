import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Chat } from '@qlan-ro/mainframe-types';
import { listChats, createChat, renameChat, pinChat, archiveChat, unarchiveChat } from '../chats';
import { setActiveDaemon } from '../../daemon/active-daemon';

const LOCAL_DAEMON = {
  id: 'local',
  kind: 'local',
  label: 'Local',
  baseUrl: 'http://127.0.0.1:31415',
  token: null,
} as const;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const port = 31415;
const chatId = 'chat-abc123';

const CHAT_FIXTURE: Chat = {
  id: chatId,
  adapterId: 'claude',
  projectId: 'proj-1',
  title: 'Test Chat',
  status: 'active',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-06-01T00:00:00.000Z',
  totalCost: 0,
  totalTokensInput: 0,
  totalTokensOutput: 0,
  lastContextTokensInput: 0,
};

// ---------------------------------------------------------------------------
// fetch mock helpers
// ---------------------------------------------------------------------------

function mockFetchOk(data: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true, data }),
    }),
  );
}

function mockFetchEmpty(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true }),
    }),
  );
}

function mockFetchHttpError(status: number, error: string): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: false,
      status,
      json: () => Promise.resolve({ error }),
    }),
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
  setActiveDaemon({ ...LOCAL_DAEMON });
});

afterEach(() => {
  vi.unstubAllGlobals();
  setActiveDaemon({ ...LOCAL_DAEMON });
});

// ---------------------------------------------------------------------------
// listChats
// ---------------------------------------------------------------------------

describe('listChats', () => {
  it('calls GET /api/chats with no query params when no filter is provided', async () => {
    mockFetchOk([CHAT_FIXTURE]);

    await listChats(port);

    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:31415/api/chats', { method: 'GET' });
  });

  it('appends ?project= when project filter is supplied', async () => {
    mockFetchOk([CHAT_FIXTURE]);

    await listChats(port, { project: 'proj-1' });

    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:31415/api/chats?project=proj-1', { method: 'GET' });
  });

  it('appends comma-joined ?tags= param when tags filter is supplied', async () => {
    mockFetchOk([CHAT_FIXTURE]);

    await listChats(port, { tags: ['alpha', 'beta'] });

    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:31415/api/chats?tags=alpha%2Cbeta', { method: 'GET' });
  });

  it('appends ?synthetic= param when synthetic filter is supplied', async () => {
    mockFetchOk([CHAT_FIXTURE]);

    await listChats(port, { synthetic: ['has-pr'] });

    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:31415/api/chats?synthetic=has-pr', { method: 'GET' });
  });

  it('combines project, tags, and synthetic into a single URL', async () => {
    mockFetchOk([CHAT_FIXTURE]);

    await listChats(port, { project: 'proj-1', tags: ['alpha'], synthetic: ['has-pr'] });

    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:31415/api/chats?project=proj-1&tags=alpha&synthetic=has-pr', {
      method: 'GET',
    });
  });

  it('returns the unwrapped Chat[] from the ApiResponse envelope', async () => {
    mockFetchOk([CHAT_FIXTURE]);

    const result = await listChats(port);

    expect(result).toEqual([CHAT_FIXTURE]);
  });

  it('throws the error message when HTTP response is not ok (404)', async () => {
    mockFetchHttpError(404, 'not found');

    await expect(listChats(port)).rejects.toThrow('not found');
  });
});

// ---------------------------------------------------------------------------
// createChat
// ---------------------------------------------------------------------------

describe('createChat', () => {
  it('calls POST /api/chats with projectId and adapterId', async () => {
    mockFetchOk(CHAT_FIXTURE);

    await createChat(port, { projectId: 'proj-1', adapterId: 'claude' });

    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:31415/api/chats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"projectId":"proj-1","adapterId":"claude"}',
    });
  });

  it('includes model in the body when provided', async () => {
    mockFetchOk(CHAT_FIXTURE);

    await createChat(port, { projectId: 'proj-1', adapterId: 'claude', model: 'claude-opus-4-5' });

    const [, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(init.body).toContain('"model":"claude-opus-4-5"');
  });

  it('includes worktreePath in the body when provided', async () => {
    mockFetchOk(CHAT_FIXTURE);

    await createChat(port, { projectId: 'proj-1', adapterId: 'claude', worktreePath: '/tmp/wt' });

    const [, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(init.body).toContain('"worktreePath":"/tmp/wt"');
  });

  it('includes branchName in the body when provided', async () => {
    mockFetchOk(CHAT_FIXTURE);

    await createChat(port, { projectId: 'proj-1', adapterId: 'claude', branchName: 'feat/x' });

    const [, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(init.body).toContain('"branchName":"feat/x"');
  });

  it('includes permissionMode in the body when provided', async () => {
    mockFetchOk(CHAT_FIXTURE);

    await createChat(port, { projectId: 'proj-1', adapterId: 'claude', permissionMode: 'default' });

    const [, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(init.body).toContain('"permissionMode":"default"');
  });

  it('returns the unwrapped Chat from the ApiResponse envelope', async () => {
    mockFetchOk(CHAT_FIXTURE);

    const result = await createChat(port, { projectId: 'proj-1', adapterId: 'claude' });

    expect(result).toEqual(CHAT_FIXTURE);
  });
});

// ---------------------------------------------------------------------------
// renameChat
// ---------------------------------------------------------------------------

describe('renameChat', () => {
  it('calls PATCH /api/chats/:id/title with the new title', async () => {
    mockFetchOk(CHAT_FIXTURE);

    await renameChat(port, chatId, 'New Name');

    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:31415/api/chats/chat-abc123/title', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: '{"title":"New Name"}',
    });
  });

  it('returns the unwrapped Chat from the ApiResponse envelope', async () => {
    mockFetchOk(CHAT_FIXTURE);

    const result = await renameChat(port, chatId, 'New Name');

    expect(result).toEqual(CHAT_FIXTURE);
  });
});

// ---------------------------------------------------------------------------
// pinChat
// ---------------------------------------------------------------------------

describe('pinChat', () => {
  it('calls PATCH /api/chats/:id/pinned with pinned:true', async () => {
    mockFetchOk(CHAT_FIXTURE);

    await pinChat(port, chatId, true);

    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:31415/api/chats/chat-abc123/pinned', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: '{"pinned":true}',
    });
  });

  it('calls PATCH /api/chats/:id/pinned with pinned:false', async () => {
    mockFetchOk(CHAT_FIXTURE);

    await pinChat(port, chatId, false);

    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:31415/api/chats/chat-abc123/pinned', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: '{"pinned":false}',
    });
  });

  it('returns the unwrapped Chat from the ApiResponse envelope', async () => {
    mockFetchOk(CHAT_FIXTURE);

    const result = await pinChat(port, chatId, true);

    expect(result).toEqual(CHAT_FIXTURE);
  });
});

// ---------------------------------------------------------------------------
// archiveChat
// ---------------------------------------------------------------------------

describe('archiveChat', () => {
  it('calls POST /api/chats/:id/archive with no query string when deleteWorktree is true', async () => {
    mockFetchEmpty();

    await archiveChat(port, chatId, true);

    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:31415/api/chats/chat-abc123/archive', {
      method: 'POST',
    });
  });

  it('appends ?deleteWorktree=false when deleteWorktree is false', async () => {
    mockFetchEmpty();

    await archiveChat(port, chatId, false);

    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:31415/api/chats/chat-abc123/archive?deleteWorktree=false', {
      method: 'POST',
    });
  });

  it('returns void on success', async () => {
    mockFetchEmpty();

    const result = await archiveChat(port, chatId, true);

    expect(result).toBeUndefined();
  });

  it('throws the error message when HTTP response is not ok (404)', async () => {
    mockFetchHttpError(404, 'not found');

    await expect(archiveChat(port, chatId, true)).rejects.toThrow('not found');
  });
});

// ---------------------------------------------------------------------------
// unarchiveChat
// ---------------------------------------------------------------------------

describe('unarchiveChat', () => {
  it('calls POST /api/chats/:id/unarchive', async () => {
    mockFetchOk(CHAT_FIXTURE);

    await unarchiveChat(port, chatId);

    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:31415/api/chats/chat-abc123/unarchive', {
      method: 'POST',
    });
  });

  it('returns the unwrapped Chat from the ApiResponse envelope', async () => {
    mockFetchOk(CHAT_FIXTURE);

    const result = await unarchiveChat(port, chatId);

    expect(result).toEqual(CHAT_FIXTURE);
  });
});
