/**
 * Workflow admin endpoints: interactions, connectors, credentials.
 * Split from workflows.ts to stay within the 300-line file limit.
 */
import { Router } from 'express';
import { z } from 'zod';
import type { RouteContext } from './types.js';
import { param } from './types.js';
import { ok, okEmpty, fail } from './respond.js';
import { asyncHandler } from './async-handler.js';
import { createChildLogger } from '../../logger.js';

const logger = createChildLogger('routes:workflow-admin');

const LabelSchema = z.string().regex(/^[a-zA-Z0-9_-]+$/);
const RespondBody = z.object({ response: z.record(z.string(), z.unknown()) });
const CredentialBody = z.object({ token: z.string() });

export function workflowAdminRoutes(ctx: RouteContext): Router {
  const router = Router();

  // ── interactions ──────────────────────────────────────────────────────────

  router.get(
    '/api/workflow-interactions',
    asyncHandler(async (_req, res) => {
      const service = ctx.workflows;
      if (!service) return void fail(res, 503, 'workflow service not available');
      const pending = service.interactions.listPending().map((i) => ({
        id: i.id,
        runId: i.runId,
        stepPath: i.stepPath,
        title: i.title,
        formSchema: i.formSchema,
        createdAt: i.createdAt,
        expiresAt: i.expiresAt,
      }));
      ok(res, pending);
    }),
  );

  router.post(
    '/api/workflow-interactions/:id/respond',
    asyncHandler(async (req, res) => {
      const service = ctx.workflows;
      if (!service) return void fail(res, 503, 'workflow service not available');
      const interactionId = param(req, 'id');
      const interaction = service.interactions.get(interactionId);
      if (!interaction) return void fail(res, 404, 'interaction not found');

      const parsed = RespondBody.safeParse(req.body);
      if (!parsed.success) return void fail(res, 400, parsed.error.message);

      try {
        await service.interactionService.respond(interactionId, parsed.data.response);
        okEmpty(res);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn({ err, interactionId }, 'respond failed');
        if (msg.includes('already answered') || msg.includes('already answered or expired')) {
          return void fail(res, 409, msg);
        }
        fail(res, 400, msg);
      }
    }),
  );

  // ── connectors ────────────────────────────────────────────────────────────

  router.get('/api/workflow-connectors', (_req, res) => {
    const service = ctx.workflows;
    if (!service) return void fail(res, 503, 'workflow service not available');
    ok(res, service.connectors.catalog());
  });

  // ── credentials ───────────────────────────────────────────────────────────

  router.get('/api/workflow-credentials', (_req, res) => {
    const service = ctx.workflows;
    if (!service) return void fail(res, 503, 'workflow service not available');
    // Never return values — only labels.
    ok(res, { labels: service.credentials.labels() });
  });

  router.put(
    '/api/workflow-credentials/:label',
    asyncHandler(async (req, res) => {
      const service = ctx.workflows;
      if (!service) return void fail(res, 503, 'workflow service not available');
      const label = param(req, 'label');
      const labelParsed = LabelSchema.safeParse(label);
      if (!labelParsed.success) return void fail(res, 400, `invalid label '${label}': must match ^[a-zA-Z0-9_-]+$`);

      const parsed = CredentialBody.safeParse(req.body);
      if (!parsed.success) return void fail(res, 400, parsed.error.message);

      try {
        service.credentials.set(label, { kind: 'token', token: parsed.data.token });
        okEmpty(res);
      } catch (err) {
        logger.error({ err, label }, 'set credential failed');
        fail(res, 500, 'failed to save credential');
      }
    }),
  );

  router.delete(
    '/api/workflow-credentials/:label',
    asyncHandler(async (req, res) => {
      const service = ctx.workflows;
      if (!service) return void fail(res, 503, 'workflow service not available');
      const label = param(req, 'label');
      const labelParsed = LabelSchema.safeParse(label);
      if (!labelParsed.success) return void fail(res, 400, `invalid label '${label}': must match ^[a-zA-Z0-9_-]+$`);

      try {
        service.credentials.delete(label);
        okEmpty(res);
      } catch (err) {
        logger.error({ err, label }, 'delete credential failed');
        fail(res, 500, 'failed to delete credential');
      }
    }),
  );

  return router;
}
