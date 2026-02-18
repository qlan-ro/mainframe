import { describe, it, expect, vi, beforeEach } from 'vitest';
import { attachmentRoutes } from '../../server/routes/attachments.js';
import type { RouteContext } from '../../server/routes/types.js';

function createMockContext(withStore = true): RouteContext {
  return {
    db: {
      projects: { get: vi.fn() },
      chats: { list: vi.fn() },
      settings: { get: vi.fn() },
    } as any,
    chats: { getChat: vi.fn(), on: vi.fn() } as any,
    adapters: { get: vi.fn(), list: vi.fn() } as any,
    attachmentStore: withStore
      ? ({
          save: vi.fn(),
          get: vi.fn(),
        } as any)
      : undefined,
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

describe('attachmentRoutes', () => {
  let ctx: RouteContext;

  beforeEach(() => {
    ctx = createMockContext();
  });

  describe('POST /api/chats/:id/attachments', () => {
    it('saves valid attachments', async () => {
      const saved = [{ id: 'att1', name: 'file.txt' }];
      (ctx.attachmentStore!.save as any).mockResolvedValue(saved);

      const router = attachmentRoutes(ctx);
      const handler = extractHandler(router, 'post', '/api/chats/:id/attachments');
      const res = mockRes();

      const attachments = [{ name: 'file.txt', mediaType: 'text/plain', data: 'aGVsbG8=', sizeBytes: 5 }];

      await handler({ params: { id: 'c1' }, query: {}, body: { attachments } }, res, vi.fn());

      expect(ctx.attachmentStore!.save).toHaveBeenCalledWith('c1', expect.any(Array));
      expect(res.json).toHaveBeenCalledWith({ success: true, data: { attachments: saved } });
    });

    it('returns 500 when attachment store is not configured', async () => {
      ctx = createMockContext(false);
      const router = attachmentRoutes(ctx);
      const handler = extractHandler(router, 'post', '/api/chats/:id/attachments');
      const res = mockRes();

      await handler({ params: { id: 'c1' }, query: {}, body: { attachments: [] } }, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: 'Attachment store not configured',
      });
    });

    it('rejects empty attachments array', async () => {
      const router = attachmentRoutes(ctx);
      const handler = extractHandler(router, 'post', '/api/chats/:id/attachments');
      const res = mockRes();

      await handler({ params: { id: 'c1' }, query: {}, body: { attachments: [] } }, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
    });

    it('rejects non-array attachments', async () => {
      const router = attachmentRoutes(ctx);
      const handler = extractHandler(router, 'post', '/api/chats/:id/attachments');
      const res = mockRes();

      await handler({ params: { id: 'c1' }, query: {}, body: { attachments: 'not-array' } }, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('rejects missing body', async () => {
      const router = attachmentRoutes(ctx);
      const handler = extractHandler(router, 'post', '/api/chats/:id/attachments');
      const res = mockRes();

      await handler({ params: { id: 'c1' }, query: {}, body: {} }, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('rejects too many attachments (>10)', async () => {
      const router = attachmentRoutes(ctx);
      const handler = extractHandler(router, 'post', '/api/chats/:id/attachments');
      const res = mockRes();

      const attachments = Array.from({ length: 11 }, (_, i) => ({
        name: `file${i}.txt`,
        mediaType: 'text/plain',
        data: 'aGVsbG8=',
        sizeBytes: 5,
      }));

      await handler({ params: { id: 'c1' }, query: {}, body: { attachments } }, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
    });

    it('rejects oversized attachment (>5MB) via sizeBytes', async () => {
      const router = attachmentRoutes(ctx);
      const handler = extractHandler(router, 'post', '/api/chats/:id/attachments');
      const res = mockRes();

      const oversize = 6 * 1024 * 1024;
      const attachments = [
        { name: 'big.bin', mediaType: 'application/octet-stream', data: 'aGVsbG8=', sizeBytes: oversize },
      ];

      await handler({ params: { id: 'c1' }, query: {}, body: { attachments } }, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: 'Attachment exceeds 5MB limit',
      });
    });

    it('rejects oversized attachment via computed data size', async () => {
      const router = attachmentRoutes(ctx);
      const handler = extractHandler(router, 'post', '/api/chats/:id/attachments');
      const res = mockRes();

      // Create a base64 data string whose decoded size exceeds 5MB.
      // base64 ratio is ~3/4. To get 6MB decoded, we need ~8MB base64.
      const largeData = 'A'.repeat(8 * 1024 * 1024);
      const attachments = [{ name: 'big.bin', mediaType: 'application/octet-stream', data: largeData, sizeBytes: 0 }];

      await handler({ params: { id: 'c1' }, query: {}, body: { attachments } }, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: 'Attachment exceeds 5MB limit',
      });
    });

    it('rejects attachment missing required fields', async () => {
      const router = attachmentRoutes(ctx);
      const handler = extractHandler(router, 'post', '/api/chats/:id/attachments');
      const res = mockRes();

      const attachments = [{ name: 'file.txt', mediaType: 'text/plain' }]; // missing data

      await handler({ params: { id: 'c1' }, query: {}, body: { attachments } }, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
    });
  });

  describe('GET /api/chats/:chatId/attachments/:attachmentId', () => {
    it('returns attachment data', async () => {
      const attachment = { id: 'att1', name: 'file.txt', data: 'aGVsbG8=' };
      (ctx.attachmentStore!.get as any).mockResolvedValue(attachment);

      const router = attachmentRoutes(ctx);
      const handler = extractHandler(router, 'get', '/api/chats/:chatId/attachments/:attachmentId');
      const res = mockRes();

      await handler({ params: { chatId: 'c1', attachmentId: 'att1' }, query: {} }, res, vi.fn());

      expect(ctx.attachmentStore!.get).toHaveBeenCalledWith('c1', 'att1');
      expect(res.json).toHaveBeenCalledWith(attachment);
    });

    it('returns 404 when attachment not found', async () => {
      (ctx.attachmentStore!.get as any).mockResolvedValue(null);

      const router = attachmentRoutes(ctx);
      const handler = extractHandler(router, 'get', '/api/chats/:chatId/attachments/:attachmentId');
      const res = mockRes();

      await handler({ params: { chatId: 'c1', attachmentId: 'nope' }, query: {} }, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: 'Attachment not found',
      });
    });

    it('returns 500 when store is not configured', async () => {
      ctx = createMockContext(false);
      const router = attachmentRoutes(ctx);
      const handler = extractHandler(router, 'get', '/api/chats/:chatId/attachments/:attachmentId');
      const res = mockRes();

      await handler({ params: { chatId: 'c1', attachmentId: 'att1' }, query: {} }, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(500);
    });
  });
});
