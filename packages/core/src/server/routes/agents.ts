import { Router, Request, Response } from 'express';
import type { RouteContext } from './types.js';
import { param } from './types.js';
import { asyncHandler } from './async-handler.js';
import { validate, CreateAgentBody, UpdateAgentBody } from './schemas.js';
import { createChildLogger } from '../../logger.js';

const logger = createChildLogger('routes:agents');

export function agentRoutes(ctx: RouteContext): Router {
  const router = Router();

  router.get(
    '/api/adapters/:adapterId/agents',
    asyncHandler(async (req: Request, res: Response) => {
      const adapter = ctx.adapters.get(param(req, 'adapterId'));
      if (!adapter?.listAgents) {
        res.status(404).json({ success: false, error: 'Adapter not found or does not support agents' });
        return;
      }
      const projectPath = req.query.projectPath as string;
      if (!projectPath) {
        res.status(400).json({ success: false, error: 'projectPath is required' });
        return;
      }

      const agents = await adapter.listAgents(projectPath);
      res.json({ success: true, data: agents });
    }),
  );

  router.post(
    '/api/adapters/:adapterId/agents',
    asyncHandler(async (req: Request, res: Response) => {
      const adapter = ctx.adapters.get(param(req, 'adapterId'));
      if (!adapter?.createAgent) {
        res.status(404).json({ success: false, error: 'Adapter not found or does not support agents' });
        return;
      }
      const parsed = validate(CreateAgentBody, req.body);
      if (!parsed.success) {
        res.status(400).json({ success: false, error: parsed.error });
        return;
      }
      const { projectPath, name, description, content, scope } = parsed.data;

      try {
        const agent = await adapter.createAgent(projectPath, {
          name,
          description: description ?? '',
          content: content ?? '',
          scope: scope ?? 'project',
        });
        res.json({ success: true, data: agent });
      } catch (err) {
        logger.warn({ err, adapterId: param(req, 'adapterId'), name }, 'Failed to create agent');
        res.status(500).json({ success: false, error: 'Operation failed' });
      }
    }),
  );

  router.put(
    '/api/adapters/:adapterId/agents/:id',
    asyncHandler(async (req: Request, res: Response) => {
      const adapter = ctx.adapters.get(param(req, 'adapterId'));
      if (!adapter?.updateAgent) {
        res.status(404).json({ success: false, error: 'Adapter not found or does not support agents' });
        return;
      }
      const parsed = validate(UpdateAgentBody, req.body);
      if (!parsed.success) {
        res.status(400).json({ success: false, error: parsed.error });
        return;
      }
      const { projectPath, content } = parsed.data;

      try {
        const agent = await adapter.updateAgent(decodeURIComponent(param(req, 'id')), projectPath, content);
        res.json({ success: true, data: agent });
      } catch (err) {
        logger.warn({ err, agentId: param(req, 'id') }, 'Failed to update agent');
        res.status(500).json({ success: false, error: 'Operation failed' });
      }
    }),
  );

  router.delete(
    '/api/adapters/:adapterId/agents/:id',
    asyncHandler(async (req: Request, res: Response) => {
      const adapter = ctx.adapters.get(param(req, 'adapterId'));
      if (!adapter?.deleteAgent) {
        res.status(404).json({ success: false, error: 'Adapter not found or does not support agents' });
        return;
      }
      const projectPath = (req.query.projectPath || req.body?.projectPath) as string;
      if (!projectPath) {
        res.status(400).json({ success: false, error: 'projectPath is required' });
        return;
      }

      try {
        await adapter.deleteAgent(decodeURIComponent(param(req, 'id')), projectPath);
        res.json({ success: true });
      } catch (err) {
        logger.warn({ err, agentId: param(req, 'id') }, 'Failed to delete agent');
        res.status(500).json({ success: false, error: 'Operation failed' });
      }
    }),
  );

  return router;
}
