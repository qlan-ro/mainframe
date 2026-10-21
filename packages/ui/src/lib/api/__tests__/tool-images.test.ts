import { afterEach, expect, it, vi } from 'vitest';
import { getToolImage } from '../tool-images';
import { setActiveDaemon } from '../../daemon/active-daemon';

const local = { id: 'local', kind: 'local', label: 'Local', baseUrl: 'http://127.0.0.1:31415', token: null } as const;
afterEach(() => {
  vi.unstubAllGlobals();
  setActiveDaemon(local);
});

it('resolves image references against the active daemon and uses its bearer authentication', async () => {
  setActiveDaemon({
    id: 'remote',
    kind: 'remote',
    label: 'Remote',
    baseUrl: 'https://daemon.example',
    token: 'test-only-token',
  });
  const image = { mediaType: 'image/png', data: 'AAAA' };
  const fetcher = vi
    .fn()
    .mockResolvedValue({ ok: true, status: 200, json: async () => ({ success: true, data: image }) });
  vi.stubGlobal('fetch', fetcher);
  const path = '/api/chats/chat/tool-result/tool/images/0?v=0123456789abcdef';
  expect(await getToolImage(path)).toEqual(image);
  expect(fetcher).toHaveBeenCalledWith(`https://daemon.example${path}`, {
    method: 'GET',
    headers: { Authorization: 'Bearer test-only-token' },
  });
});

it.each(['https://other.example/image', '//other.example/image', '/api/chats/../settings', '/api/other'])(
  'rejects untrusted image reference %s before making a request',
  async (uri) => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    await expect(getToolImage(uri)).rejects.toThrow('Invalid tool image reference');
    expect(fetcher).not.toHaveBeenCalled();
  },
);

it('shares pending requests and reuses fetched pixels after a row remounts', async () => {
  const image = { mediaType: 'image/png', data: 'AAAA' };
  const fetcher = vi
    .fn()
    .mockResolvedValue({ ok: true, status: 200, json: async () => ({ success: true, data: image }) });
  vi.stubGlobal('fetch', fetcher);
  const uri = '/api/chats/chat/tool-result/tool/images/0?v=0123456789abcdef';
  await Promise.all([getToolImage(uri), getToolImage(uri)]);
  expect(await getToolImage(uri)).toEqual(image);
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it('retries a failed request and clears cached images when the daemon changes', async () => {
  const fetcher = vi
    .fn()
    .mockRejectedValueOnce(new Error('Disconnected'))
    .mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: { mediaType: 'image/png', data: 'AAAA' } }),
    });
  vi.stubGlobal('fetch', fetcher);
  const uri = '/api/chats/chat/tool-result/tool/images/0?v=0123456789abcdef';
  await expect(getToolImage(uri)).rejects.toThrow('Disconnected');
  await getToolImage(uri);
  setActiveDaemon({ ...local, id: 'other', baseUrl: 'http://127.0.0.1:32114' });
  await getToolImage(uri);
  expect(fetcher).toHaveBeenCalledTimes(3);
  expect(fetcher.mock.calls[2]?.[0]).toBe(`http://127.0.0.1:32114${uri}`);
});

it('evicts old image data when the cache reaches its memory budget', async () => {
  const fetcher = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ success: true, data: { mediaType: 'image/png', data: 'A'.repeat(6_000_000) } }),
  });
  vi.stubGlobal('fetch', fetcher);
  const uri = (index: number) => `/api/chats/chat/tool-result/tool/images/${index}?v=0123456789abcdef`;
  for (let index = 0; index < 4; index++) await getToolImage(uri(index));
  await getToolImage(uri(3));
  expect(fetcher).toHaveBeenCalledTimes(4);
  await getToolImage(uri(0));
  expect(fetcher).toHaveBeenCalledTimes(5);
});
