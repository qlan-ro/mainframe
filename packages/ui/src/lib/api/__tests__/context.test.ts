import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SessionContext } from '@qlan-ro/mainframe-types';
import { getSessionContext } from '../context';

const EMPTY: SessionContext = {
  globalFiles: [],
  projectFiles: [],
  mentions: [],
  attachments: [],
  modifiedFiles: [],
  skillFiles: [],
};

afterEach(() => vi.restoreAllMocks());

describe('getSessionContext', () => {
  it('GETs the chat context route and unwraps the data envelope', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: EMPTY }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await getSessionContext(31415, 'chat-7');

    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:31415/api/chats/chat-7/context', expect.anything());
    expect(result).toEqual(EMPTY);
  });

  it('throws when the envelope reports failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: false, error: 'nope' }) }),
    );
    await expect(getSessionContext(31415, 'chat-7')).rejects.toThrow('nope');
  });
});
