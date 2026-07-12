// packages/core/src/server/routes/automation-admin.ts
//
// Task 25. Interactions, action catalog, credentials — mirrors v1
// workflow-admin.ts. Credential routes follow contract Decision 6:
// GET list returns labels only, GET :label returns {label, kind} (never
// the value), and the `^[a-zA-Z0-9_-]+$` label regex naturally rejects the
// reserved `webhook:<hookId>` labels (colon isn't in the character class),
// keeping those out of user-facing credential CRUD without extra checks.
import { Router } from 'express';
import { z } from 'zod';
import type { RouteContext } from './types.js';
import { param } from './types.js';
import { ok, okEmpty, fail } from './respond.js';
import { asyncHandler } from './async-handler.js';
import { createChildLogger } from '../../logger.js';
import { toInteractionSummary } from '../../automations/verbs/ask-me.js';

const logger = createChildLogger('routes:automation-admin');

const LabelSchema = z.string().regex(/^[a-zA-Z0-9_-]+$/);
const RespondBody = z.object({ response: z.record(z.string(), z.unknown()) });
const CredentialBody = z.object({ token: z.string() });

export function automationAdminRoutes(ctx: RouteContext): Router {
  const router = Router();

  // ── interactions ─────────────────────────────────────────────────────────

  router.get('/api/automation-interactions', (_req, res) => {
    const service = ctx.automations;
    if (!service) return void fail(res, 503, 'automation service not available');
    ok(res, service.interactions.listPending().map(toInteractionSummary));
  });

  router.post(
    '/api/automation-interactions/:id/respond',
    asyncHandler(async (req, res) => {
      const service = ctx.automations;
      if (!service) return void fail(res, 503, 'automation service not available');
      const id = param(req, 'id');
      if (!service.interactions.get(id)) return void fail(res, 404, 'interaction not found');

      const parsed = RespondBody.safeParse(req.body);
      if (!parsed.success) return void fail(res, 400, parsed.error.message);

      try {
        await service.interactionService.respond(id, parsed.data.response);
        okEmpty(res);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn({ err, id }, 'respond failed');
        if (msg.includes('already answered') || msg.includes('already cancelled')) return void fail(res, 409, msg);
        fail(res, 400, msg);
      }
    }),
  );

  // ── action catalog ───────────────────────────────────────────────────────

  router.get('/api/automation-actions', (_req, res) => {
    const service = ctx.automations;
    if (!service) return void fail(res, 503, 'automation service not available');
    ok(res, service.registry.catalog());
  });

  // ── credentials ──────────────────────────────────────────────────────────

  router.get('/api/automation-credentials', (_req, res) => {
    const service = ctx.automations;
    if (!service) return void fail(res, 503, 'automation service not available');
    ok(res, { labels: service.credentials.labels() });
  });

  router.get('/api/automation-credentials/:label', (req, res) => {
    const service = ctx.automations;
    if (!service) return void fail(res, 503, 'automation service not available');
    const label = param(req, 'label');
    if (!LabelSchema.safeParse(label).success) {
      return void fail(res, 400, `invalid label '${label}': must match ^[a-zA-Z0-9_-]+$`);
    }
    const creds = service.credentials.get(label);
    if (!creds) return void fail(res, 404, 'credential not found');
    ok(res, { label, kind: creds.kind });
  });

  router.put(
    '/api/automation-credentials/:label',
    asyncHandler(async (req, res) => {
      const service = ctx.automations;
      if (!service) return void fail(res, 503, 'automation service not available');
      const label = param(req, 'label');
      if (!LabelSchema.safeParse(label).success) {
        return void fail(res, 400, `invalid label '${label}': must match ^[a-zA-Z0-9_-]+$`);
      }
      const parsed = CredentialBody.safeParse(req.body);
      if (!parsed.success) return void fail(res, 400, parsed.error.message);

      try {
        await service.credentials.set(label, { kind: 'token', token: parsed.data.token });
        okEmpty(res);
      } catch (err) {
        logger.error({ err, label }, 'set credential failed');
        fail(res, 500, 'failed to save credential');
      }
    }),
  );

  router.delete(
    '/api/automation-credentials/:label',
    asyncHandler(async (req, res) => {
      const service = ctx.automations;
      if (!service) return void fail(res, 503, 'automation service not available');
      const label = param(req, 'label');
      if (!LabelSchema.safeParse(label).success) {
        return void fail(res, 400, `invalid label '${label}': must match ^[a-zA-Z0-9_-]+$`);
      }
      try {
        await service.credentials.delete(label);
        okEmpty(res);
      } catch (err) {
        logger.error({ err, label }, 'delete credential failed');
        fail(res, 500, 'failed to delete credential');
      }
    }),
  );

  return router;
}
