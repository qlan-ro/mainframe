import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

import { getToolResultContent } from '../projects-api';

describe('getToolResultContent', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('GETs the expand endpoint and returns content', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ success: true, data: { content: 'FULL' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const result = await getToolResultContent('c1', 'tu_1');

    expect(result).toBe('FULL');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0]!;
    expect(url).toMatch(/\/api\/chats\/c1\/tool-result\/tu_1$/);
  });

  it('throws on a non-ok response', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ success: false, error: 'Not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await expect(getToolResultContent('c1', 'tu_x')).rejects.toThrow();
  });
});
