import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { FileResult, FileTreeEntry, ResolvePathResult } from '../files';
import {
  searchFiles,
  getFileTree,
  browseFilesystem,
  getProjectFile,
  getProjectFileBase64,
  saveProjectFile,
  resolvePath,
} from '../files';

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

describe('getProjectFileBase64', () => {
  it('GETs /files with encoding=base64 and returns the content', async () => {
    mockFetchOk({ path: 'assets/logo.png', content: 'aGVsbG8=' });

    const content = await getProjectFileBase64(31415, 'proj-1', 'assets/logo.png', 'chat-abc');

    expect(content).toBe('aGVsbG8=');
    const url = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
    expect(url).toContain('/api/projects/proj-1/files?');
    expect(url).toContain('encoding=base64');
    expect(url).toContain('path=assets%2Flogo.png');
    expect(url).toContain('chatId=chat-abc');
  });

  it('omits chatId when not passed', async () => {
    mockFetchOk({ path: 'assets/logo.png', content: 'aGVsbG8=' });

    await getProjectFileBase64(31415, 'proj-1', 'assets/logo.png');

    const url = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
    expect(url).toContain('encoding=base64');
    expect(url).not.toContain('chatId');
  });

  it('URL-encodes the projectId', async () => {
    mockFetchOk({ path: 'img.png', content: 'abc' });

    await getProjectFileBase64(31415, 'my project/1', 'img.png');

    const url = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
    expect(url).toContain('/api/projects/my%20project%2F1/files');
  });

  it('throws when success is false', async () => {
    mockFetchApiError('file not found');

    await expect(getProjectFileBase64(31415, 'proj-1', 'missing.png')).rejects.toThrow('file not found');
  });
});

// ---------------------------------------------------------------------------
// saveProjectFile
// ---------------------------------------------------------------------------

describe('saveProjectFile', () => {
  it('PUTs /api/projects/:id/files with path and content in the JSON body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true, data: { path: 'src/a.ts' } }),
      }),
    );

    await saveProjectFile(31415, 'proj-1', 'src/a.ts', 'const x = 1\n');

    expect(fetch).toHaveBeenCalledOnce();
    const [url, opts] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:31415/api/projects/proj-1/files');
    expect(opts.method).toBe('PUT');
    const body = JSON.parse(opts.body as string) as Record<string, string>;
    expect(body.path).toBe('src/a.ts');
    expect(body.content).toBe('const x = 1\n');
    expect(body.chatId).toBeUndefined();
  });

  it('includes chatId in the body when provided', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true, data: { path: 'src/a.ts' } }),
      }),
    );

    await saveProjectFile(31415, 'proj-1', 'src/a.ts', 'hello', 'chat-abc');

    const [, opts] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(opts.body as string) as Record<string, string>;
    expect(body.chatId).toBe('chat-abc');
  });

  it('URL-encodes the projectId', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true, data: { path: 'a.ts' } }),
      }),
    );

    await saveProjectFile(31415, 'my project/1', 'a.ts', 'x');

    const [url] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/projects/my%20project%2F1/files');
  });

  it('throws when success is false', async () => {
    mockFetchApiError('Path outside project');

    await expect(saveProjectFile(31415, 'proj-1', '../etc/passwd', 'x')).rejects.toThrow('Path outside project');
  });

  it('throws when the HTTP response is not ok', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ error: 'write failed' }),
      }),
    );

    await expect(saveProjectFile(31415, 'proj-1', 'a.ts', 'x')).rejects.toThrow('write failed');
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

// ---------------------------------------------------------------------------
// resolvePath
// ---------------------------------------------------------------------------

const RESOLVE_FIXTURE: ResolvePathResult = {
  relative: 'src/index.ts',
  absolute: '/home/user/project/src/index.ts',
  baseKind: 'project',
  basePath: '/home/user/project',
  contained: true,
};

describe('resolvePath', () => {
  it('GETs /paths/resolve with the path param and returns the parsed object', async () => {
    mockFetchOk(RESOLVE_FIXTURE);

    const result = await resolvePath(31415, 'proj-1', 'src/index.ts');

    expect(result).toEqual(RESOLVE_FIXTURE);
    const url = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
    expect(url).toContain('/api/projects/proj-1/paths/resolve?');
    expect(url).toContain('path=src%2Findex.ts');
    expect(url).not.toContain('chatId');
  });

  it('includes chatId in the query string when provided', async () => {
    mockFetchOk(RESOLVE_FIXTURE);

    await resolvePath(31415, 'proj-1', 'src/index.ts', 'chat-abc');

    const url = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
    expect(url).toContain('chatId=chat-abc');
    expect(url).toContain('path=src%2Findex.ts');
  });

  it('omits chatId from the query string when not provided', async () => {
    mockFetchOk(RESOLVE_FIXTURE);

    await resolvePath(31415, 'proj-1', 'src/index.ts');

    const url = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
    expect(url).not.toContain('chatId');
  });

  it('URL-encodes the projectId', async () => {
    mockFetchOk(RESOLVE_FIXTURE);

    await resolvePath(31415, 'my project/1', 'src/index.ts');

    const url = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
    expect(url).toContain('/api/projects/my%20project%2F1/paths/resolve');
  });

  it('returns contained:false result when the daemon reports an external path', async () => {
    const externalFixture: ResolvePathResult = {
      relative: '../other/file.ts',
      absolute: '/other/file.ts',
      baseKind: 'project',
      basePath: '/home/user/project',
      contained: false,
    };
    mockFetchOk(externalFixture);

    const result = await resolvePath(31415, 'proj-1', '/other/file.ts');

    expect(result.contained).toBe(false);
    expect(result.absolute).toBe('/other/file.ts');
  });

  it('throws when success is false (e.g. project not found)', async () => {
    mockFetchApiError('Project not found');

    await expect(resolvePath(31415, 'no-such-project', 'a.ts')).rejects.toThrow('Project not found');
  });

  it('throws when the HTTP response is not ok', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 409,
        json: () => Promise.resolve({ error: 'Worktree missing' }),
      }),
    );

    await expect(resolvePath(31415, 'proj-1', 'a.ts', 'chat-gone')).rejects.toThrow('Worktree missing');
  });
});
