import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getBackgroundTaskOutput, killBackgroundTask } from '../background-tasks';
import { setActiveDaemon } from '../../daemon/active-daemon';

const LOCAL_DAEMON = {
  id: 'local',
  kind: 'local',
  label: 'Local',
  baseUrl: 'http://127.0.0.1:31415',
  token: null,
} as const;

beforeEach(() => {
  setActiveDaemon({ ...LOCAL_DAEMON });
});

afterEach(() => {
  vi.restoreAllMocks();
  setActiveDaemon({ ...LOCAL_DAEMON });
});

function mockFetch(res: { ok: boolean; status: number; json?: () => unknown; text?: () => unknown }) {
  const fetchMock = vi.fn().mockResolvedValue(res);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('killBackgroundTask', () => {
  it('resolves ok on a success envelope', async () => {
    const fetchMock = mockFetch({ ok: true, status: 200, json: async () => ({ success: true }) });

    const result = await killBackgroundTask('chat-1', 'task-1');

    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:31415/api/chats/chat-1/background-tasks/task-1/kill',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(result).toEqual({ kind: 'ok' });
  });

  it('resolves not-found on a 404 task-not-found envelope', async () => {
    mockFetch({ ok: false, status: 404, json: async () => ({ success: false, error: 'task not found' }) });

    const result = await killBackgroundTask('chat-1', 'task-1');

    expect(result).toEqual({ kind: 'not-found' });
  });

  it('resolves error with the daemon message on a 502', async () => {
    mockFetch({ ok: false, status: 502, json: async () => ({ success: false, error: 'no live writer' }) });

    const result = await killBackgroundTask('chat-1', 'task-1');

    expect(result).toEqual({ kind: 'error', message: 'no live writer' });
  });

  it('resolves error with a readable message on a malformed body', async () => {
    mockFetch({
      ok: false,
      status: 502,
      json: () => {
        throw new Error('not json');
      },
    });

    const result = await killBackgroundTask('chat-1', 'task-1');

    expect(result.kind).toBe('error');
  });
});

describe('getBackgroundTaskOutput', () => {
  it('returns the tail text on 2xx and sends ?bytes=8192 by default', async () => {
    const fetchMock = mockFetch({ ok: true, status: 200, text: async () => 'hello output' });

    const result = await getBackgroundTaskOutput('chat-1', 'task-1');

    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:31415/api/chats/chat-1/background-tasks/task-1/output?bytes=8192',
      expect.anything(),
    );
    expect(result).toEqual({ kind: 'text', text: 'hello output' });
  });

  it('passes a custom byte count through', async () => {
    const fetchMock = mockFetch({ ok: true, status: 200, text: async () => '' });

    await getBackgroundTaskOutput('chat-1', 'task-1', 4096);

    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('?bytes=4096'), expect.anything());
  });

  it('maps no_output to none', async () => {
    mockFetch({ ok: false, status: 409, json: async () => ({ success: false, error: 'no_output' }) });

    const result = await getBackgroundTaskOutput('chat-1', 'task-1');

    expect(result).toEqual({ kind: 'none' });
  });

  it('maps invalid_path to error', async () => {
    mockFetch({ ok: false, status: 409, json: async () => ({ success: false, error: 'invalid_path' }) });

    const result = await getBackgroundTaskOutput('chat-1', 'task-1');

    expect(result).toEqual({ kind: 'error', message: 'invalid_path' });
  });

  it('maps read failed to error', async () => {
    mockFetch({ ok: false, status: 500, json: async () => ({ success: false, error: 'read failed' }) });

    const result = await getBackgroundTaskOutput('chat-1', 'task-1');

    expect(result).toEqual({ kind: 'error', message: 'read failed' });
  });

  it('maps a malformed body to a readable error', async () => {
    mockFetch({
      ok: false,
      status: 500,
      json: () => {
        throw new Error('not json');
      },
    });

    const result = await getBackgroundTaskOutput('chat-1', 'task-1');

    expect(result.kind).toBe('error');
  });
});
