import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { listBackgroundTasks, readBackgroundTaskOutput } from '../background-tasks';

const fetchMock = vi.fn();
beforeEach(() => vi.stubGlobal('fetch', fetchMock));
afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

describe('readBackgroundTaskOutput', () => {
  it('asks for as much as the daemon sends', async () => {
    fetchMock.mockResolvedValue(new Response('all of it'));
    expect(await readBackgroundTaskOutput('chat/1', 'bg 1')).toEqual({ text: 'all of it', truncated: false });
    const url = new URL(fetchMock.mock.calls[0]![0] as string);
    expect(url.pathname).toBe('/api/chats/chat%2F1/background-tasks/bg%201/output');
    expect(url.searchParams.get('bytes')).toBe('1048576');
  });

  it('says when the daemon left out the start', async () => {
    fetchMock.mockResolvedValue(new Response('the end', { headers: { 'X-Output-Truncated': 'true' } }));
    expect(await readBackgroundTaskOutput('c', 't')).toEqual({ text: 'the end', truncated: true });
  });

  it('is empty where there is no output, and fails otherwise', async () => {
    fetchMock.mockResolvedValueOnce(new Response('', { status: 409 }));
    expect(await readBackgroundTaskOutput('c', 't')).toEqual({ text: '', truncated: false });
    fetchMock.mockResolvedValueOnce(new Response('', { status: 500 }));
    await expect(readBackgroundTaskOutput('c', 't')).rejects.toThrow('Output request failed (500)');
  });
});

describe('listBackgroundTasks', () => {
  it('is given up with its signal', async () => {
    fetchMock.mockImplementation(
      (_: string, { signal }: RequestInit) =>
        new Promise((_resolve, reject) => signal!.addEventListener('abort', () => reject(new Error('gone')))),
    );
    const controller = new AbortController();
    const tasks = listBackgroundTasks('c', controller.signal);
    controller.abort();
    await expect(tasks).rejects.toThrow('gone');
  });

  it('asks with no signal when there is none', async () => {
    fetchMock.mockResolvedValue(Response.json({ success: true, data: { tasks: [] } }));
    expect(await listBackgroundTasks('c')).toEqual([]);
    expect(fetchMock.mock.lastCall![1]).toEqual({ method: 'GET' });
  });
});
