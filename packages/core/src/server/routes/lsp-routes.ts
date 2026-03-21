import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import type { LspManager } from '../../lsp/lsp-manager.js';
import type { LspLanguageStatus } from '@qlan-ro/mainframe-types';
import { asyncHandler } from './async-handler.js';

const LspLanguagesQuerySchema = z.object({
  projectId: z.string().uuid(),
});

export function lspRoutes(manager: LspManager): Router {
  const router = Router();

  router.get(
    '/api/lsp/languages',
    asyncHandler(async (req: Request, res: Response) => {
      const parsed = LspLanguagesQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json({ success: false, error: parsed.error.issues });
        return;
      }

      const { projectId } = parsed.data;
      const activeLanguages = manager.getActiveLanguages(projectId);
      const allIds = manager.registry.getAllLanguageIds();

      const languages: LspLanguageStatus[] = await Promise.all(
        allIds.map(async (id) => {
          const resolved = await manager.registry.resolveCommand(id);
          return {
            id,
            installed: resolved !== null,
            active: activeLanguages.includes(id),
          };
        }),
      );

      res.json({ languages });
    }),
  );

  return router;
}
