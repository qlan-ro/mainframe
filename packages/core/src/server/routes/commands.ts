import { Router } from 'express';
import type { RouteContext } from './types.js';
import { getMainframeCommands } from '../../commands/registry.js';
import { asyncHandler } from './async-handler.js';
import type { CustomCommand } from '@mainframe/types';

export function commandRoutes(ctx: RouteContext): Router {
  const router = Router();

  router.get(
    '/api/commands',
    asyncHandler(async (_req, res) => {
      const commands: CustomCommand[] = [...getMainframeCommands()];
      for (const adapter of ctx.adapters.getAll()) {
        if (adapter.listCommands) {
          commands.push(...adapter.listCommands());
        }
      }
      res.json({ success: true, data: commands });
    }),
  );

  return router;
}
