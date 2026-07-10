/**
 * getExternalFile / getFileForView — the read-only escape hatch for absolute
 * paths outside the project (chat tool-cards pointing at /tmp etc).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getExternalFile, getFileForView } from '../files';
import { setActiveDaemon } from '../../daemon/active-daemon';

const LOCAL_DAEMON = {
  id: 'local',
  kind: 'local',
  label: 'Local',
  baseUrl: 'http://127.0.0.1:31415',
  token: null,
} as const;

function fetchMock(): ReturnType<typeof vi.fn> {
  return fetch as ReturnType<typeof vi.fn>;
}

function okResponse(data: unknown) {
  return { ok: true, json: () => Promise.resolve({ success: true, data }) };
}

function apiErrorResponse(error: string) {
  return { ok: true, json: () => Promise.resolve({ success: false, error }) };
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
  setActiveDaemon({ ...LOCAL_DAEMON });
});

afterEach(() => {
  vi.unstubAllGlobals();
  setActiveDaemon({ ...LOCAL_DAEMON });
});

describe('getExternalFile', () => {
  it('GETs /api/files/external with the absolute path', async () => {
    fetchMock().mockResolvedValue(okResponse({ path: '/tmp/notes.txt', content: 'hello' }));

    const content = await getExternalFile(31415, '/tmp/notes.txt');

    expect(content).toBe('hello');
    const url = fetchMock().mock.calls[0]?.[0] as string;
    expect(url).toContain('/api/files/external?');
    expect(url).toContain('path=%2Ftmp%2Fnotes.txt');
    expect(url).not.toContain('encoding');
  });

  it('appends encoding=base64 when requested', async () => {
    fetchMock().mockResolvedValue(okResponse({ path: '/tmp/img.png', content: 'aGVsbG8=', encoding: 'base64' }));

    const content = await getExternalFile(31415, '/tmp/img.png', 'base64');

    expect(content).toBe('aGVsbG8=');
    const url = fetchMock().mock.calls[0]?.[0] as string;
    expect(url).toContain('encoding=base64');
  });

  it('throws the daemon error (blocked sensitive path)', async () => {
    fetchMock().mockResolvedValue(apiErrorResponse('Access to this path is not allowed'));

    await expect(getExternalFile(31415, '/home/u/.ssh/id_rsa')).rejects.toThrow('Access to this path is not allowed');
  });
});

describe('getFileForView', () => {
  it('returns the project route content with external:false when contained', async () => {
    fetchMock().mockResolvedValue(okResponse({ path: 'src/a.ts', content: 'inside' }));

    const result = await getFileForView(31415, 'proj-1', 'src/a.ts', 'chat-1');

    expect(result).toEqual({ content: 'inside', external: false });
    expect(fetchMock()).toHaveBeenCalledTimes(1);
  });

  it('falls back to the external endpoint on "Path outside project" for an absolute path', async () => {
    fetchMock()
      .mockResolvedValueOnce(apiErrorResponse('Path outside project'))
      .mockResolvedValueOnce(okResponse({ path: '/tmp/out.txt', content: 'outside' }));

    const result = await getFileForView(31415, 'proj-1', '/tmp/out.txt', 'chat-1');

    expect(result).toEqual({ content: 'outside', external: true });
    expect(fetchMock()).toHaveBeenCalledTimes(2);
    const secondUrl = fetchMock().mock.calls[1]?.[0] as string;
    expect(secondUrl).toContain('/api/files/external?');
    expect(secondUrl).toContain('path=%2Ftmp%2Fout.txt');
  });

  it('carries base64 through the external fallback', async () => {
    fetchMock()
      .mockResolvedValueOnce(apiErrorResponse('Path outside project'))
      .mockResolvedValueOnce(okResponse({ path: '/tmp/img.png', content: 'aGVsbG8=', encoding: 'base64' }));

    const result = await getFileForView(31415, 'proj-1', '/tmp/img.png', undefined, { base64: true });

    expect(result).toEqual({ content: 'aGVsbG8=', external: true });
    const firstUrl = fetchMock().mock.calls[0]?.[0] as string;
    const secondUrl = fetchMock().mock.calls[1]?.[0] as string;
    expect(firstUrl).toContain('encoding=base64');
    expect(secondUrl).toContain('encoding=base64');
  });

  it('falls back for a Windows drive-letter absolute path', async () => {
    fetchMock()
      .mockResolvedValueOnce(apiErrorResponse('Path outside project'))
      .mockResolvedValueOnce(okResponse({ path: 'C:\\Users\\u\\shot.png', content: 'win' }));

    const result = await getFileForView(31415, 'proj-1', 'C:\\Users\\u\\shot.png', 'chat-1');

    expect(result).toEqual({ content: 'win', external: true });
    expect(fetchMock()).toHaveBeenCalledTimes(2);
  });

  it('falls back for a UNC absolute path', async () => {
    fetchMock()
      .mockResolvedValueOnce(apiErrorResponse('Path outside project'))
      .mockResolvedValueOnce(okResponse({ path: '\\\\server\\share\\doc.txt', content: 'unc' }));

    const result = await getFileForView(31415, 'proj-1', '\\\\server\\share\\doc.txt');

    expect(result).toEqual({ content: 'unc', external: true });
    expect(fetchMock()).toHaveBeenCalledTimes(2);
  });

  it('does NOT fall back for a Windows relative escape (..\\..)', async () => {
    fetchMock().mockResolvedValue(apiErrorResponse('Path outside project'));

    await expect(getFileForView(31415, 'proj-1', '..\\..\\secrets.txt')).rejects.toThrow('Path outside project');
    expect(fetchMock()).toHaveBeenCalledTimes(1);
  });

  it('does NOT fall back for a relative path escape (../..)', async () => {
    fetchMock().mockResolvedValue(apiErrorResponse('Path outside project'));

    await expect(getFileForView(31415, 'proj-1', '../../etc/passwd')).rejects.toThrow('Path outside project');
    expect(fetchMock()).toHaveBeenCalledTimes(1);
  });

  it('rethrows non-containment errors without a fallback', async () => {
    fetchMock().mockResolvedValue(apiErrorResponse('File not found'));

    await expect(getFileForView(31415, 'proj-1', '/tmp/missing.txt')).rejects.toThrow('File not found');
    expect(fetchMock()).toHaveBeenCalledTimes(1);
  });
});
