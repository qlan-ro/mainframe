import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

import {
  getChat,
  createChat,
  updateChatConfig,
  interruptChatRest,
  resumeChatRest,
  editQueuedMessageRest,
  cancelQueuedMessageRest,
} from './chats-api';

const CHAT_FIXTURE = { id: 'c1', projectId: 'p1', title: 'Test Chat' };

function okResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify({ success: true, data }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function errResponse(error: string, status = 400): Response {
  return new Response(JSON.stringify({ success: false, error }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('chats-api', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('getChat', () => {
    it('GETs /api/chats/:id and returns unwrapped Chat', async () => {
      fetchMock.mockResolvedValue(okResponse(CHAT_FIXTURE));
      const chat = await getChat('c1');
      const [url, init] = fetchMock.mock.calls[0]!;
      expect(url).toMatch(/\/api\/chats\/c1$/);
      expect(init).toBeUndefined();
      expect(chat).toEqual(CHAT_FIXTURE);
    });

    it('throws when envelope success is false', async () => {
      fetchMock.mockResolvedValue(
        new Response(JSON.stringify({ success: false, error: 'Not found' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
      await expect(getChat('missing')).rejects.toThrow('Not found');
    });
  });

  describe('createChat', () => {
    it('POSTs to /api/chats with body and returns unwrapped Chat', async () => {
      fetchMock.mockResolvedValue(okResponse(CHAT_FIXTURE));
      const chat = await createChat({ projectId: 'p1', adapterId: 'claude' });
      const [url, init] = fetchMock.mock.calls[0]!;
      expect(url).toMatch(/\/api\/chats$/);
      expect(init?.method).toBe('POST');
      expect(JSON.parse(init?.body as string)).toMatchObject({ projectId: 'p1', adapterId: 'claude' });
      expect(chat).toEqual(CHAT_FIXTURE);
    });

    it('throws when server returns !ok', async () => {
      fetchMock.mockResolvedValue(errResponse('Bad request', 400));
      await expect(createChat({ projectId: 'p1', adapterId: 'claude' })).rejects.toThrow();
    });

    it('throws when envelope success is false', async () => {
      fetchMock.mockResolvedValue(
        new Response(JSON.stringify({ success: false, error: 'Create failed' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
      await expect(createChat({ projectId: 'p1', adapterId: 'claude' })).rejects.toThrow('Create failed');
    });
  });

  describe('updateChatConfig', () => {
    it('PATCHes /api/chats/:id/config and returns unwrapped Chat', async () => {
      fetchMock.mockResolvedValue(okResponse(CHAT_FIXTURE));
      const chat = await updateChatConfig('c1', { model: 'claude-3-5-sonnet' });
      const [url, init] = fetchMock.mock.calls[0]!;
      expect(url).toMatch(/\/api\/chats\/c1\/config$/);
      expect(init?.method).toBe('PATCH');
      expect(JSON.parse(init?.body as string)).toMatchObject({ model: 'claude-3-5-sonnet' });
      expect(chat).toEqual(CHAT_FIXTURE);
    });

    it('throws when envelope success is false', async () => {
      fetchMock.mockResolvedValue(
        new Response(JSON.stringify({ success: false, error: 'Config update failed' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
      await expect(updateChatConfig('c1', {})).rejects.toThrow('Config update failed');
    });
  });

  describe('interruptChatRest', () => {
    it('POSTs to /api/chats/:id/interrupt', async () => {
      fetchMock.mockResolvedValue(okResponse(null));
      await interruptChatRest('c1');
      const [url, init] = fetchMock.mock.calls[0]!;
      expect(url).toMatch(/\/api\/chats\/c1\/interrupt$/);
      expect(init?.method).toBe('POST');
    });

    it('throws when envelope success is false', async () => {
      fetchMock.mockResolvedValue(
        new Response(JSON.stringify({ success: false, error: 'Interrupt failed' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
      await expect(interruptChatRest('c1')).rejects.toThrow('Interrupt failed');
    });
  });

  describe('resumeChatRest', () => {
    it('POSTs to /api/chats/:id/resume', async () => {
      fetchMock.mockResolvedValue(okResponse(null));
      await resumeChatRest('c1');
      const [url, init] = fetchMock.mock.calls[0]!;
      expect(url).toMatch(/\/api\/chats\/c1\/resume$/);
      expect(init?.method).toBe('POST');
    });

    it('throws when envelope success is false', async () => {
      fetchMock.mockResolvedValue(
        new Response(JSON.stringify({ success: false, error: 'Resume failed' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
      await expect(resumeChatRest('c1')).rejects.toThrow('Resume failed');
    });
  });

  describe('editQueuedMessageRest', () => {
    it('PATCHes /api/chats/:id/queue/:messageId with content', async () => {
      fetchMock.mockResolvedValue(okResponse(null));
      await editQueuedMessageRest('c1', 'm1', 'new content');
      const [url, init] = fetchMock.mock.calls[0]!;
      expect(url).toMatch(/\/api\/chats\/c1\/queue\/m1$/);
      expect(init?.method).toBe('PATCH');
      expect(JSON.parse(init?.body as string)).toEqual({ content: 'new content' });
    });

    it('throws when envelope success is false', async () => {
      fetchMock.mockResolvedValue(
        new Response(JSON.stringify({ success: false, error: 'Edit failed' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
      await expect(editQueuedMessageRest('c1', 'm1', 'content')).rejects.toThrow('Edit failed');
    });
  });

  describe('cancelQueuedMessageRest', () => {
    it('DELETEs /api/chats/:id/queue/:messageId', async () => {
      fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
      await cancelQueuedMessageRest('c1', 'm1');
      const [url, init] = fetchMock.mock.calls[0]!;
      expect(url).toMatch(/\/api\/chats\/c1\/queue\/m1$/);
      expect(init?.method).toBe('DELETE');
    });

    it('throws when server returns !ok', async () => {
      fetchMock.mockResolvedValue(errResponse('Not found', 404));
      await expect(cancelQueuedMessageRest('c1', 'm1')).rejects.toThrow();
    });
  });
});
