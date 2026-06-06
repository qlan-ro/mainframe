import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { FileResult } from '../files';
import { searchFiles } from '../files';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FILE_FIXTURE: FileResult[] = [
  { name: 'index.ts', path: 'src/index.ts', type: 'file', exact: true },
  { name: 'utils.ts', path: 'src/utils/utils.ts', type: 'file', exact: false },
];

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

function mockFetchApiError(error: string): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: false, error }),
    }),
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('searchFiles', () => {
  it('calls GET /api/projects/<projectId>/search/files with q and limit=30', async () => {
    mockFetchOk(FILE_FIXTURE);

    await searchFiles(31415, 'proj-1', 'index');

    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:31415/api/projects/proj-1/search/files?q=index&limit=30', {
      method: 'GET',
    });
  });

  it('includes chatId in the query string when passed', async () => {
    mockFetchOk([]);

    await searchFiles(31415, 'proj-1', 'utils', 'chat-abc');

    const calledUrl = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
    expect(calledUrl).toContain('chatId=chat-abc');
    expect(calledUrl).toContain('q=utils');
    expect(calledUrl).toContain('limit=30');
  });

  it('omits chatId from the query string when not passed', async () => {
    mockFetchOk([]);

    await searchFiles(31415, 'proj-1', 'src');

    const calledUrl = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
    expect(calledUrl).not.toContain('chatId');
  });

  it('URL-encodes the projectId in the path', async () => {
    mockFetchOk([]);

    await searchFiles(31415, 'my project/1', 'foo');

    const calledUrl = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
    expect(calledUrl).toContain('/api/projects/my%20project%2F1/search/files');
  });

  it('returns the unwrapped FileResult[] from the ApiResponse envelope', async () => {
    mockFetchOk(FILE_FIXTURE);

    const result = await searchFiles(31415, 'proj-1', 'index');

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ name: 'index.ts', path: 'src/index.ts', type: 'file', exact: true });
    expect(result[1]).toEqual({ name: 'utils.ts', path: 'src/utils/utils.ts', type: 'file', exact: false });
  });

  it('throws when success is false', async () => {
    mockFetchApiError('project not found');

    await expect(searchFiles(31415, 'proj-1', 'foo')).rejects.toThrow('project not found');
  });

  it('throws when the HTTP response is not ok', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: () => Promise.resolve({ error: 'not found' }),
      }),
    );

    await expect(searchFiles(31415, 'proj-1', 'foo')).rejects.toThrow('not found');
  });
});
