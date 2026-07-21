import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { attachmentRoutes } from '../../server/routes/attachments.js';
import { AttachmentStore } from '../../attachment/index.js';
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

    // Oversized-data case: base64 ratio is ~3/4, so ~8MB of base64 decodes to
    // just over the 5MB limit even though the caller-supplied sizeBytes is 0 —
    // proving the route computes actual decoded size rather than trusting it.
    const oversizedDataAttachment = {
      name: 'big.bin',
      mediaType: 'application/octet-stream',
      data: 'A'.repeat(8 * 1024 * 1024),
      sizeBytes: 0,
    };

    // bodyCheck mirrors exactly what each original test asserted about the
    // response body: 'none' (status only), 'partial' (success:false shape),
    // or the literal error string the route is contracted to return.
    it.each([
      ['empty attachments array', { attachments: [] }, 'partial'],
      ['non-array attachments', { attachments: 'not-array' }, 'none'],
      ['missing body', {}, 'none'],
      [
        'too many attachments (>10)',
        {
          attachments: Array.from({ length: 11 }, (_, i) => ({
            name: `file${i}.txt`,
            mediaType: 'text/plain',
            data: 'aGVsbG8=',
            sizeBytes: 5,
          })),
        },
        'partial',
      ],
      [
        'oversized attachment (>5MB) via sizeBytes',
        {
          attachments: [
            { name: 'big.bin', mediaType: 'application/octet-stream', data: 'aGVsbG8=', sizeBytes: 6 * 1024 * 1024 },
          ],
        },
        'Attachment exceeds 5MB limit',
      ],
      [
        'oversized attachment via computed data size',
        { attachments: [oversizedDataAttachment] },
        'Attachment exceeds 5MB limit',
      ],
      [
        'attachment missing required fields',
        { attachments: [{ name: 'file.txt', mediaType: 'text/plain' }] }, // missing data
        'partial',
      ],
      ['empty mediaType', { attachments: [{ name: 'a.png', mediaType: '', data: 'aGVsbG8=' }] }, 'partial'],
      ['missing mediaType', { attachments: [{ name: 'a.png', data: 'aGVsbG8=' }] }, 'partial'],
    ] as const)('rejects: %s', async (_label, body, bodyCheck) => {
      const router = attachmentRoutes(ctx);
      const handler = extractHandler(router, 'post', '/api/chats/:id/attachments');
      const res = mockRes();

      await handler({ params: { id: 'c1' }, query: {}, body }, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(400);
      if (bodyCheck === 'partial') {
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
      } else if (bodyCheck !== 'none') {
        expect(res.json).toHaveBeenCalledWith({ success: false, error: bodyCheck });
      }
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
      expect(res.json).toHaveBeenCalledWith({ success: true, data: attachment });
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

  // Real AttachmentStore: covers the route's kind derivation and the only
  // save→get round-trip coverage the store has.
  describe('with a real AttachmentStore', () => {
    let baseDir: string;

    beforeEach(async () => {
      baseDir = await mkdtemp(join(tmpdir(), 'mf-attachments-'));
      ctx = createMockContext();
      ctx.attachmentStore = new AttachmentStore(baseDir);
    });

    afterEach(async () => {
      await rm(baseDir, { recursive: true, force: true });
    });

    const smallImage = { name: 'a.png', mediaType: 'image/png', data: Buffer.from('hello').toString('base64') };

    async function post(body: unknown) {
      const router = attachmentRoutes(ctx);
      const handler = extractHandler(router, 'post', '/api/chats/:id/attachments');
      const res = mockRes();
      await handler({ params: { id: 'c1' }, query: {}, body }, res, vi.fn());
      return res;
    }

    it('saves a valid attachment, deriving kind image from the mediaType', async () => {
      const res = await post({ attachments: [smallImage] });

      const { attachments } = res.json.mock.calls[0][0].data;
      expect(attachments).toHaveLength(1);
      expect(attachments[0]).toMatchObject({ name: 'a.png', mediaType: 'image/png', kind: 'image' });
      expect(typeof attachments[0].id).toBe('string');
    });

    it('defaults kind to file for a non-image mediaType', async () => {
      const res = await post({ attachments: [{ name: 'doc.txt', mediaType: 'text/plain', data: 'aGVsbG8=' }] });

      expect(res.json.mock.calls[0][0].data.attachments[0].kind).toBe('file');
    });

    it('serves the stored attachment back via GET (round-trip)', async () => {
      const upload = await post({ attachments: [smallImage] });
      const id = upload.json.mock.calls[0][0].data.attachments[0].id as string;

      const router = attachmentRoutes(ctx);
      const handler = extractHandler(router, 'get', '/api/chats/:chatId/attachments/:attachmentId');
      const res = mockRes();
      await handler({ params: { chatId: 'c1', attachmentId: id }, query: {} }, res, vi.fn());

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({ name: 'a.png', mediaType: 'image/png' }),
        }),
      );
    });
  });
});
