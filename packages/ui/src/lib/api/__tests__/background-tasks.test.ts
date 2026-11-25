import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readBackgroundTaskOutput } from '../background-tasks';

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
