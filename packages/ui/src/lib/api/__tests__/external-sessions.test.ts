import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Chat, ExternalSessionPage } from '@qlan-ro/mainframe-types';
import { getExternalSessions, importExternalSession } from '../external-sessions';
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
const projectId = 'proj-abc';

const PAGE_FIXTURE: ExternalSessionPage = {
  sessions: [],
  total: 0,
  nextOffset: null,
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

// ---------------------------------------------------------------------------
// Setup / teardown
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
// getExternalSessions
// ---------------------------------------------------------------------------

describe('getExternalSessions', () => {
  it('requests a page with offset/limit and returns the page', async () => {
    mockFetchOk(PAGE_FIXTURE);

    const result = await getExternalSessions(port, projectId, { offset: 50, limit: 50 });

    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:31415/api/projects/proj-abc/external-sessions?offset=50&limit=50',
      { method: 'GET' },
    );
    expect(result).toBe(PAGE_FIXTURE);
  });

  it('defaults offset=0 and limit=50 when opts are omitted', async () => {
    mockFetchOk(PAGE_FIXTURE);

    await getExternalSessions(port, projectId);

    expect(fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:31415/api/projects/proj-abc/external-sessions?offset=0&limit=50',
      { method: 'GET' },
    );
  });

  it('uses the correct projectId in the URL (different project)', async () => {
    mockFetchOk(PAGE_FIXTURE);

    await getExternalSessions(port, 'proj-xyz', { offset: 0, limit: 10 });

    expect(fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:31415/api/projects/proj-xyz/external-sessions?offset=0&limit=10',
      { method: 'GET' },
    );
  });
});

// ---------------------------------------------------------------------------
// importExternalSession
// ---------------------------------------------------------------------------

describe('importExternalSession', () => {
  it('POSTs the required sessionId and adapterId fields to the exact import URL', async () => {
    mockFetchOk(CHAT_FIXTURE);

    await importExternalSession(port, projectId, {
      sessionId: 'sess-001',
      adapterId: 'claude',
    });

    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:31415/api/projects/proj-abc/external-sessions/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"sessionId":"sess-001","adapterId":"claude"}',
    });
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
});
