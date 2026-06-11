import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { FileResult, FileTreeEntry } from '../files';
import { searchFiles, getFileTree, browseFilesystem, getProjectFile } from '../files';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FILE_FIXTURE: FileResult[] = [
  { name: 'index.ts', path: 'src/index.ts', type: 'file', exact: true },
  { name: 'utils.ts', path: 'src/utils/utils.ts', type: 'file', exact: false },
];

const TREE_FIXTURE: FileTreeEntry[] = [
  { name: 'src', path: 'src', type: 'directory' },
  { name: 'README.md', path: 'README.md', type: 'file' },
];

const BROWSE_FIXTURE: FileTreeEntry[] = [
  { name: 'Documents', path: '/Users/me/Documents', type: 'directory' },
  { name: 'notes.txt', path: '/Users/me/notes.txt', type: 'file' },
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

// ---------------------------------------------------------------------------
// searchFiles
// ---------------------------------------------------------------------------

describe('getProjectFile', () => {
  it('GETs /files with the path and returns the content (relative tree path)', async () => {
    mockFetchOk({ path: 'src/a.ts', content: 'export const x = 1\n' });

    const content = await getProjectFile(31415, 'proj-1', 'src/a.ts', 'chat-abc');

    expect(content).toBe('export const x = 1\n');
    const url = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
    expect(url).toContain('/api/projects/proj-1/files?');
    expect(url).toContain('path=src%2Fa.ts');
    expect(url).toContain('chatId=chat-abc');
  });

  it('passes an absolute path through unchanged (chat tool-card path)', async () => {
    mockFetchOk({ path: '/repo/src/a.ts', content: 'abs' });

    await getProjectFile(31415, 'proj-1', '/repo/src/a.ts');

    const url = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
    expect(url).toContain('path=%2Frepo%2Fsrc%2Fa.ts');
    expect(url).not.toContain('chatId');
  });
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

// ---------------------------------------------------------------------------
// getFileTree
// ---------------------------------------------------------------------------

describe('getFileTree', () => {
  it('calls GET /api/projects/<projectId>/tree?path=. by default', async () => {
    mockFetchOk(TREE_FIXTURE);

    await getFileTree(31415, 'proj-1');

    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:31415/api/projects/proj-1/tree?path=.', { method: 'GET' });
  });

  it('uses the provided dir argument in the path param', async () => {
    mockFetchOk(TREE_FIXTURE);

    await getFileTree(31415, 'proj-1', 'src/components');

    const calledUrl = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
    expect(calledUrl).toContain('path=src%2Fcomponents');
  });

  it('includes chatId when provided', async () => {
    mockFetchOk([]);

    await getFileTree(31415, 'proj-1', '.', 'chat-xyz');

    const calledUrl = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
    expect(calledUrl).toContain('chatId=chat-xyz');
  });

  it('omits chatId when not provided', async () => {
    mockFetchOk([]);

    await getFileTree(31415, 'proj-1', '.');

    const calledUrl = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
    expect(calledUrl).not.toContain('chatId');
  });

  it('URL-encodes the projectId in the path', async () => {
    mockFetchOk([]);

    await getFileTree(31415, 'my project/1');

    const calledUrl = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
    expect(calledUrl).toContain('/api/projects/my%20project%2F1/tree');
  });

  it('returns the unwrapped FileTreeEntry[] from the ApiResponse envelope', async () => {
    mockFetchOk(TREE_FIXTURE);

    const result = await getFileTree(31415, 'proj-1');

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ name: 'src', path: 'src', type: 'directory' });
    expect(result[1]).toEqual({ name: 'README.md', path: 'README.md', type: 'file' });
  });

  it('throws when success is false', async () => {
    mockFetchApiError('project not found');

    await expect(getFileTree(31415, 'proj-1')).rejects.toThrow('project not found');
  });
});

// ---------------------------------------------------------------------------
// browseFilesystem
// ---------------------------------------------------------------------------

describe('browseFilesystem', () => {
  it('calls GET /api/filesystem/browse?path=<dir>', async () => {
    mockFetchOk({ path: '/Users/me', entries: BROWSE_FIXTURE });

    await browseFilesystem(31415, '/Users/me');

    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:31415/api/filesystem/browse?path=%2FUsers%2Fme', {
      method: 'GET',
    });
  });

  it('appends includeFiles=true when set', async () => {
    mockFetchOk({ path: '/Users/me', entries: BROWSE_FIXTURE });

    await browseFilesystem(31415, '/Users/me', { includeFiles: true });

    const calledUrl = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
    expect(calledUrl).toContain('includeFiles=true');
  });

  it('appends includeHidden=false when set', async () => {
    mockFetchOk({ path: '/Users/me', entries: BROWSE_FIXTURE });

    await browseFilesystem(31415, '/Users/me', { includeHidden: false });

    const calledUrl = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
    expect(calledUrl).toContain('includeHidden=false');
  });

  it('omits includeFiles/includeHidden when opts not provided', async () => {
    mockFetchOk({ path: '/Users/me', entries: [] });

    await browseFilesystem(31415, '/Users/me');

    const calledUrl = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
    expect(calledUrl).not.toContain('includeFiles');
    expect(calledUrl).not.toContain('includeHidden');
  });

  it('returns the entries array unwrapped from the nested data.entries shape', async () => {
    mockFetchOk({ path: '/Users/me', entries: BROWSE_FIXTURE });

    const result = await browseFilesystem(31415, '/Users/me', { includeFiles: true, includeHidden: false });

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ name: 'Documents', path: '/Users/me/Documents', type: 'directory' });
    expect(result[1]).toEqual({ name: 'notes.txt', path: '/Users/me/notes.txt', type: 'file' });
  });

  it('throws when success is false', async () => {
    mockFetchApiError('path not found');

    await expect(browseFilesystem(31415, '/bad/path')).rejects.toThrow('path not found');
  });

  it('throws when the HTTP response is not ok', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ error: 'server error' }),
      }),
    );

    await expect(browseFilesystem(31415, '/Users/me')).rejects.toThrow('server error');
  });
});
