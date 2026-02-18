import { Router, Request, Response } from 'express';
import type { RouteContext } from './types.js';
import { param } from './types.js';
import { validate, UploadAttachmentsBody } from './schemas.js';

const MAX_ATTACHMENT_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

export function attachmentRoutes(ctx: RouteContext): Router {
  const router = Router();

  // Attachment upload — POST /api/chats/:id/attachments
  router.post('/api/chats/:id/attachments', async (req: Request, res: Response) => {
    if (!ctx.attachmentStore) {
      res.status(500).json({ success: false, error: 'Attachment store not configured' });
      return;
    }

    const parsed = validate(UploadAttachmentsBody, req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error });
      return;
    }
    const { attachments } = parsed.data;

    for (const attachment of attachments) {
      const computedSizeBytes = Math.floor((attachment.data.length * 3) / 4);
      const effectiveSize = attachment.sizeBytes ?? computedSizeBytes;
      if (effectiveSize > MAX_ATTACHMENT_SIZE_BYTES || computedSizeBytes > MAX_ATTACHMENT_SIZE_BYTES) {
        res.status(400).json({ success: false, error: 'Attachment exceeds 5MB limit' });
        return;
      }
    }

    const saved = await ctx.attachmentStore.save(
      param(req, 'id'),
      attachments.map((attachment) => ({
        sizeBytes: attachment.sizeBytes ?? Math.floor((attachment.data.length * 3) / 4),
        name: attachment.name,
        mediaType: attachment.mediaType,
        data: attachment.data,
        kind: attachment.kind ?? (attachment.mediaType.startsWith('image/') ? ('image' as const) : ('file' as const)),
        originalPath: attachment.originalPath,
      })),
    );
    res.json({ success: true, data: { attachments: saved } });
  });

  // Attachment serve — GET /api/chats/:chatId/attachments/:attachmentId
  router.get('/api/chats/:chatId/attachments/:attachmentId', async (req: Request, res: Response) => {
    if (!ctx.attachmentStore) {
      res.status(500).json({ success: false, error: 'Attachment store not configured' });
      return;
    }

    const attachment = await ctx.attachmentStore.get(param(req, 'chatId'), param(req, 'attachmentId'));
    if (!attachment) {
      res.status(404).json({ success: false, error: 'Attachment not found' });
      return;
    }
    res.json(attachment);
  });

  return router;
}
