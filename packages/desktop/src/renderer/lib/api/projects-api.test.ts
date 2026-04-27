import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

import { unarchiveChat } from './projects-api';

describe('unarchiveChat', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('POSTs to the unarchive route for the given chat', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ success: true, data: { id: 'c1', status: 'active' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await unarchiveChat('c1');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toMatch(/\/api\/chats\/c1\/unarchive$/);
    expect(init?.method).toBe('POST');
  });

  it('throws when the server returns an error status', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ success: false, error: 'Chat not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await expect(unarchiveChat('missing')).rejects.toThrow(/Chat not found/);
  });
});
