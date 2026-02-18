import { Router, Request, Response } from 'express';
import type { RouteContext } from './types.js';
import { param } from './types.js';
import { asyncHandler } from './async-handler.js';
import { validate, CreateSkillBody, UpdateSkillBody } from './schemas.js';
import { createChildLogger } from '../../logger.js';

const logger = createChildLogger('routes:skills');

export function skillRoutes(ctx: RouteContext): Router {
  const router = Router();

  router.get(
    '/api/adapters/:adapterId/skills',
    asyncHandler(async (req: Request, res: Response) => {
      const adapter = ctx.adapters.get(param(req, 'adapterId'));
      if (!adapter?.listSkills) {
        res.status(404).json({ success: false, error: 'Adapter not found or does not support skills' });
        return;
      }
      const projectPath = req.query.projectPath as string;
      if (!projectPath) {
        res.status(400).json({ success: false, error: 'projectPath is required' });
        return;
      }

      const skills = await adapter.listSkills(projectPath);
      res.json({ success: true, data: skills });
    }),
  );

  router.post(
    '/api/adapters/:adapterId/skills',
    asyncHandler(async (req: Request, res: Response) => {
      const adapter = ctx.adapters.get(param(req, 'adapterId'));
      if (!adapter?.createSkill) {
        res.status(404).json({ success: false, error: 'Adapter not found or does not support skills' });
        return;
      }
      const parsed = validate(CreateSkillBody, req.body);
      if (!parsed.success) {
        res.status(400).json({ success: false, error: parsed.error });
        return;
      }
      const { projectPath, name, displayName, description, content, scope } = parsed.data;

      try {
        const skill = await adapter.createSkill(projectPath, {
          name,
          displayName: displayName ?? name,
          description: description ?? '',
          content: content ?? '',
          scope: scope ?? 'project',
        });
        res.json({ success: true, data: skill });
      } catch (err) {
        logger.warn({ err, adapterId: param(req, 'adapterId'), name }, 'Failed to create skill');
        res.status(500).json({ success: false, error: 'Operation failed' });
      }
    }),
  );

  router.put(
    '/api/adapters/:adapterId/skills/:id',
    asyncHandler(async (req: Request, res: Response) => {
      const adapter = ctx.adapters.get(param(req, 'adapterId'));
      if (!adapter?.updateSkill) {
        res.status(404).json({ success: false, error: 'Adapter not found or does not support skills' });
        return;
      }
      const parsed = validate(UpdateSkillBody, req.body);
      if (!parsed.success) {
        res.status(400).json({ success: false, error: parsed.error });
        return;
      }
      const { projectPath, content } = parsed.data;

      try {
        const skill = await adapter.updateSkill(decodeURIComponent(param(req, 'id')), projectPath, content);
        res.json({ success: true, data: skill });
      } catch (err) {
        logger.warn({ err, skillId: param(req, 'id') }, 'Failed to update skill');
        res.status(500).json({ success: false, error: 'Operation failed' });
      }
    }),
  );

  router.delete(
    '/api/adapters/:adapterId/skills/:id',
    asyncHandler(async (req: Request, res: Response) => {
      const adapter = ctx.adapters.get(param(req, 'adapterId'));
      if (!adapter?.deleteSkill) {
        res.status(404).json({ success: false, error: 'Adapter not found or does not support skills' });
        return;
      }
      const projectPath = (req.query.projectPath || req.body?.projectPath) as string;
      if (!projectPath) {
        res.status(400).json({ success: false, error: 'projectPath is required' });
        return;
      }

      try {
        await adapter.deleteSkill(decodeURIComponent(param(req, 'id')), projectPath);
        res.json({ success: true });
      } catch (err) {
        logger.warn({ err, skillId: param(req, 'id') }, 'Failed to delete skill');
        res.status(500).json({ success: false, error: 'Operation failed' });
      }
    }),
  );

  return router;
}
