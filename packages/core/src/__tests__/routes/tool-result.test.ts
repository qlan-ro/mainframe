import { describe, it, expect, vi, beforeEach } from 'vitest';
import { chatRoutes } from '../../server/routes/chats.js';
import type { RouteContext } from '../../server/routes/types.js';

vi.mock('../../messages/read-tool-result-from-jsonl.js', () => ({
  readToolResultFromJsonl: vi.fn(),
}));

import { readToolResultFromJsonl } from '../../messages/read-tool-result-from-jsonl.js';

const flushPromises = () => new Promise<void>((r) => setTimeout(r, 0));

function createMockContext(): RouteContext {
  return {
    db: {
      projects: { get: vi.fn(), list: vi.fn() },
      chats: { list: vi.fn(), update: vi.fn(), get: vi.fn() },
      settings: { get: vi.fn() },
    } as any,
    chats: {
      getChat: vi.fn(),
      listChats: vi.fn(),
      listAllChats: vi.fn(),
      listFiltered: vi.fn(),
      archiveChat: vi.fn(),
      unarchiveChat: vi.fn(),
      getMessages: vi.fn(),
      getMessagesFromDisk: vi.fn(),
      getDisplayMessages: vi.fn(),
      getPendingPermission: vi.fn(),
      on: vi.fn(),
    } as any,
    adapters: { get: vi.fn(), list: vi.fn() } as any,
  };
}

function mockRes() {
  const res: any = {
    json: vi.fn(),
    status: vi.fn().mockReturnThis(),
  };
  return res;
}

function extractHandler(router: any, method: string, routePath: string) {
  const layer = router.stack.find((l: any) => l.route?.path === routePath && l.route?.methods[method]);
  if (!layer) throw new Error(`No handler for ${method.toUpperCase()} ${routePath}`);
  return layer.route.stack[0].handle;
}

describe('GET /api/chats/:id/tool-result/:toolUseId', () => {
  let ctx: RouteContext;

  beforeEach(() => {
    ctx = createMockContext();
    vi.clearAllMocks();
  });

  it('returns 200 with content when chat has sessionFilePath and JSONL yields content', async () => {
    const chat = {
      id: 'c1',
      projectId: 'p1',
      sessionFilePath: '/path/to/session.jsonl',
    };
    (ctx.chats.getChat as any).mockReturnValue(chat);
    (readToolResultFromJsonl as any).mockResolvedValue('tool output content');

    const router = chatRoutes(ctx);
    const handler = extractHandler(router, 'get', '/api/chats/:id/tool-result/:toolUseId');
    const res = mockRes();

    handler({ params: { id: 'c1', toolUseId: 'toolu_abc123' }, query: {} }, res, vi.fn());
    await flushPromises();

    expect(readToolResultFromJsonl).toHaveBeenCalledWith('/path/to/session.jsonl', 'toolu_abc123');
    expect(res.json).toHaveBeenCalledWith({ success: true, data: { content: 'tool output content' } });
  });

  it('returns 404 when readToolResultFromJsonl returns null', async () => {
    const chat = {
      id: 'c1',
      projectId: 'p1',
      sessionFilePath: '/path/to/session.jsonl',
    };
    (ctx.chats.getChat as any).mockReturnValue(chat);
    (readToolResultFromJsonl as any).mockResolvedValue(null);

    const router = chatRoutes(ctx);
    const handler = extractHandler(router, 'get', '/api/chats/:id/tool-result/:toolUseId');
    const res = mockRes();

    handler({ params: { id: 'c1', toolUseId: 'toolu_abc123' }, query: {} }, res, vi.fn());
    await flushPromises();

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ success: false, error: 'Tool result not available' });
  });

  it('returns 404 when the chat is not found', async () => {
    (ctx.chats.getChat as any).mockReturnValue(undefined);

    const router = chatRoutes(ctx);
    const handler = extractHandler(router, 'get', '/api/chats/:id/tool-result/:toolUseId');
    const res = mockRes();

    handler({ params: { id: 'unknown', toolUseId: 'toolu_abc123' }, query: {} }, res, vi.fn());
    await flushPromises();

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ success: false, error: 'Chat not found' });
  });

  it('returns 400 when toolUseId fails the regex validation', async () => {
    const router = chatRoutes(ctx);
    const handler = extractHandler(router, 'get', '/api/chats/:id/tool-result/:toolUseId');
    const res = mockRes();

    handler({ params: { id: 'c1', toolUseId: 'invalid id with spaces' }, query: {} }, res, vi.fn());
    await flushPromises();

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
  });
});
