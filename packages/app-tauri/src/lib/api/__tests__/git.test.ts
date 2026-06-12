import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getWorkingDiff } from '../git';

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
// Fixtures
// ---------------------------------------------------------------------------

const DIFF_FIXTURE = {
  diff: '@@ -1,3 +1,4 @@\n const x = 1\n+const y = 2\n',
  original: 'const x = 1\n',
  modified: 'const x = 1\nconst y = 2\n',
  source: 'git',
};

const EMPTY_DIFF_FIXTURE = {
  diff: '',
  original: '',
  modified: '',
  source: 'git',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('getWorkingDiff', () => {
  it('GETs /git/diff with file and source=git params', async () => {
    mockFetchOk(DIFF_FIXTURE);

    await getWorkingDiff(31415, 'proj-1', 'src/index.ts');

    const url = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
    expect(url).toContain('/api/projects/proj-1/git/diff?');
    expect(url).toContain('file=src%2Findex.ts');
    expect(url).toContain('source=git');
    expect(url).not.toContain('base=');
    expect(url).not.toContain('chatId=');
  });

  it('includes base= when opts.base is provided', async () => {
    mockFetchOk(DIFF_FIXTURE);

    await getWorkingDiff(31415, 'proj-1', 'src/index.ts', { base: 'main' });

    const url = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
    expect(url).toContain('base=main');
    expect(url).toContain('source=git');
  });

  it('includes chatId= when opts.chatId is provided', async () => {
    mockFetchOk(DIFF_FIXTURE);

    await getWorkingDiff(31415, 'proj-1', 'src/index.ts', { chatId: 'chat-abc' });

    const url = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
    expect(url).toContain('chatId=chat-abc');
    expect(url).toContain('source=git');
    expect(url).not.toContain('base=');
  });

  it('includes both base= and chatId= when both opts are provided', async () => {
    mockFetchOk(DIFF_FIXTURE);

    await getWorkingDiff(31415, 'proj-1', 'src/index.ts', { base: 'HEAD~1', chatId: 'chat-xyz' });

    const url = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
    expect(url).toContain('base=HEAD');
    expect(url).toContain('chatId=chat-xyz');
  });

  it('returns the {diff,original,modified,source} body from the response', async () => {
    mockFetchOk(DIFF_FIXTURE);

    const result = await getWorkingDiff(31415, 'proj-1', 'src/index.ts');

    expect(result).toEqual(DIFF_FIXTURE);
  });

  it('returns an empty-triple soft-error response as-is without throwing', async () => {
    mockFetchOk(EMPTY_DIFF_FIXTURE);

    const result = await getWorkingDiff(31415, 'proj-1', 'untracked.ts');

    expect(result).toEqual(EMPTY_DIFF_FIXTURE);
    expect(result.diff).toBe('');
    expect(result.original).toBe('');
    expect(result.modified).toBe('');
  });

  it('URL-encodes the projectId in the path', async () => {
    mockFetchOk(DIFF_FIXTURE);

    await getWorkingDiff(31415, 'my project/1', 'a.ts');

    const url = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
    expect(url).toContain('/api/projects/my%20project%2F1/git/diff');
  });

  it('throws when success is false', async () => {
    mockFetchApiError('project not found');

    await expect(getWorkingDiff(31415, 'proj-1', 'a.ts')).rejects.toThrow('project not found');
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

    await expect(getWorkingDiff(31415, 'proj-1', 'a.ts')).rejects.toThrow('server error');
  });
});
