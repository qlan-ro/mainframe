import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Chat, ExternalSession } from '@qlan-ro/mainframe-types';
import { getExternalSessions, importExternalSession } from '../external-sessions';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const port = 31415;
const projectId = 'proj-abc';

const EXTERNAL_SESSION_FIXTURE: ExternalSession = {
  sessionId: 'sess-001',
  adapterId: 'claude',
  projectPath: '/projects/mainframe',
  cwd: '/projects/mainframe',
  firstPrompt: 'Fix the bug in the parser',
  createdAt: '2026-01-01T00:00:00.000Z',
  modifiedAt: '2026-06-01T10:00:00.000Z',
  gitBranch: 'fix/parser-bug',
};

const CHAT_FIXTURE: Chat = {
  id: 'chat-imported-1',
  adapterId: 'claude',
  projectId,
  title: 'Fix the bug in the parser',
  status: 'active',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-06-01T10:00:00.000Z',
  totalCost: 0,
  totalTokensInput: 0,
  totalTokensOutput: 0,
  lastContextTokensInput: 0,
};

// ---------------------------------------------------------------------------
// fetch mock helpers (mirror chats-sidebar.test.ts pattern)
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
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// getExternalSessions
// ---------------------------------------------------------------------------

describe('getExternalSessions', () => {
  it('calls GET /api/projects/:projectId/external-sessions with the exact URL', async () => {
    mockFetchOk([EXTERNAL_SESSION_FIXTURE]);

    await getExternalSessions(port, projectId);

    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:31415/api/projects/proj-abc/external-sessions', {
      method: 'GET',
    });
  });

  it('returns the unwrapped ExternalSession[] from the ApiResponse envelope', async () => {
    mockFetchOk([EXTERNAL_SESSION_FIXTURE]);

    const result = await getExternalSessions(port, projectId);

    expect(result).toEqual([EXTERNAL_SESSION_FIXTURE]);
  });

  it('returns an empty array when the daemon reports no sessions', async () => {
    mockFetchOk([]);

    const result = await getExternalSessions(port, projectId);

    expect(result).toEqual([]);
  });

  it('uses the correct projectId in the URL (different project)', async () => {
    mockFetchOk([]);

    await getExternalSessions(port, 'proj-xyz');

    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:31415/api/projects/proj-xyz/external-sessions', {
      method: 'GET',
    });
  });

  it('throws the error message when the HTTP response is not ok (403)', async () => {
    mockFetchHttpError(403, 'forbidden');

    await expect(getExternalSessions(port, projectId)).rejects.toThrow('forbidden');
  });
});

// ---------------------------------------------------------------------------
// importExternalSession
// ---------------------------------------------------------------------------

describe('importExternalSession', () => {
  it('calls POST /api/projects/:projectId/external-sessions/import with the exact URL', async () => {
    mockFetchOk(CHAT_FIXTURE);

    await importExternalSession(port, projectId, {
      sessionId: 'sess-001',
      adapterId: 'claude',
    });

    expect(fetch).toHaveBeenCalledOnce();
    const [url] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:31415/api/projects/proj-abc/external-sessions/import');
  });

  it('sends a POST with Content-Type application/json', async () => {
    mockFetchOk(CHAT_FIXTURE);

    await importExternalSession(port, projectId, {
      sessionId: 'sess-001',
      adapterId: 'claude',
    });

    const [, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });

  it('sends the required sessionId and adapterId fields in the body', async () => {
    mockFetchOk(CHAT_FIXTURE);

    await importExternalSession(port, projectId, {
      sessionId: 'sess-001',
      adapterId: 'claude',
    });

    const [, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(init.body).toBe('{"sessionId":"sess-001","adapterId":"claude"}');
  });

  it('includes all optional fields (title, createdAt, modifiedAt) when provided', async () => {
    mockFetchOk(CHAT_FIXTURE);

    await importExternalSession(port, projectId, {
      sessionId: 'sess-001',
      adapterId: 'claude',
      title: 'Fix the bug in the parser',
      createdAt: '2026-01-01T00:00:00.000Z',
      modifiedAt: '2026-06-01T10:00:00.000Z',
    });

    const [, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(init.body).toBe(
      '{"sessionId":"sess-001","adapterId":"claude","title":"Fix the bug in the parser","createdAt":"2026-01-01T00:00:00.000Z","modifiedAt":"2026-06-01T10:00:00.000Z"}',
    );
  });

  it('returns the unwrapped Chat from the ApiResponse envelope', async () => {
    mockFetchOk(CHAT_FIXTURE);

    const result = await importExternalSession(port, projectId, {
      sessionId: 'sess-001',
      adapterId: 'claude',
    });

    expect(result).toEqual(CHAT_FIXTURE);
  });

  it('throws the error message when the HTTP response is not ok (500)', async () => {
    mockFetchHttpError(500, 'internal server error');

    await expect(
      importExternalSession(port, projectId, { sessionId: 'sess-001', adapterId: 'claude' }),
    ).rejects.toThrow('internal server error');
  });
});
