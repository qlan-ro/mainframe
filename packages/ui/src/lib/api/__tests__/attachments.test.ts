import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getAttachment } from '../attachments';
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

describe('getAttachment', () => {
  it('GETs the attachment route and returns the unwrapped attachment', async () => {
    const payload = {
      name: 'p.png',
      mediaType: 'image/png',
      sizeBytes: 12,
      kind: 'image' as const,
      data: 'AAAA',
    };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, data: payload }) });
    vi.stubGlobal('fetch', fetchMock);

    const result = await getAttachment(31415, 'chat-7', 'att-1');

    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:31415/api/chats/chat-7/attachments/att-1',
      expect.anything(),
    );
    expect(result).toEqual(payload);
  });
});
