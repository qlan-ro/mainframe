import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setActiveDaemon } from '../../daemon/active-daemon';
import { resolveSessionTranscripts } from '../session-transcripts';

const localDaemon = {
  id: 'local',
  kind: 'local',
  label: 'Local',
  baseUrl: 'http://127.0.0.1:31415',
  token: null,
} as const;

beforeEach(() => setActiveDaemon({ ...localDaemon }));
afterEach(() => {
  vi.unstubAllGlobals();
  setActiveDaemon({ ...localDaemon });
});

describe('resolveSessionTranscripts', () => {
  it('splits more than 500 chats into accepted batches and returns all results in order', async () => {
    const chatIds = Array.from({ length: 501 }, (_, index) => `chat-${index}`);
    const fetchMock = vi.fn().mockImplementation(async (_url: string, options: RequestInit) => {
      const ids = (JSON.parse(options.body as string) as { chatIds: string[] }).chatIds;
      return {
        ok: true,
        json: async () => ({
          success: true,
          data: { resolutions: ids.map((chatId) => ({ chatId, state: 'resolved', path: `/t/${chatId}` })) },
        }),
      };
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await resolveSessionTranscripts(31415, chatIds);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body).chatIds).toHaveLength(500);
    expect(JSON.parse(fetchMock.mock.calls[1]![1].body).chatIds).toEqual(['chat-500']);
    expect(result.map((resolution) => resolution.chatId)).toEqual(chatIds);
  });
});
