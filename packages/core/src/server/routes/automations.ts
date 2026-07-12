// packages/core/src/server/routes/automations.ts
//
// Task 24. CRUD + runs routes for Automations v2, mirroring the shape of
// v1's workflows.ts: WS4 envelope (ok/okEmpty/fail), 202 on a started
// manual run, timeline projection with 32KB output-preview truncation
// (contract §4, matching v1 workflows.ts:20's displayTruncate).
import { Router, type Response } from 'express';
import { z } from 'zod';
import type { AutomationTimelineEntry } from '@qlan-ro/mainframe-types';
import type { RouteContext } from './types.js';
import { param } from './types.js';
import { ok, okEmpty, fail } from './respond.js';
import { asyncHandler } from './async-handler.js';
import { createChildLogger } from '../../logger.js';
import { AutomationDefinitionSchema } from '../../automations/definition/schema.js';
import { AutomationValidationError } from '../../automations/service.js';
import { toRunSummary } from '../../automations/engine/interpreter.js';
import type { AutomationRunRecord } from '../../automations/store/types.js';

const logger = createChildLogger('routes:automations');

const OUTPUT_PREVIEW_MAX_BYTES = 32 * 1024;

const AutomationBodySchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  scope: z.enum(['global', 'project']),
  projectId: z.string().nullable().optional(),
  definition: AutomationDefinitionSchema,
});

/** Mirrors v1 workflows.ts:20's displayTruncate, but a single preview string rather than a raw-value/truncated pair. */
function outputPreview(outputs: Record<string, unknown> | null): string | undefined {
  if (outputs === null) return undefined;
  const json = JSON.stringify(outputs);
  const bytes = Buffer.byteLength(json);
  return bytes <= OUTPUT_PREVIEW_MAX_BYTES ? json : `[truncated — ${bytes} bytes]`;
}

function projectTimeline(run: AutomationRunRecord): AutomationTimelineEntry[] {
  return Object.entries(run.checkpoint.steps).map(([stepRef, entry]) => ({
    stepRef,
    stepId: entry.stepId,
    kind: entry.kind,
    status: entry.status,
    outputPreview: outputPreview(entry.outputs),
    error: entry.error,
    chatId: entry.chatId,
    interactionId: entry.interactionId,
    startedAt: entry.startedAt ?? undefined,
    finishedAt: entry.finishedAt ?? undefined,
  }));
}

/** Scope/schema errors carry structured `{stepId, message}[]` (contract) alongside the standard WS4 envelope. */
function failValidation(res: Response, err: AutomationValidationError): void {
  res.status(400).json({ success: false, error: err.message, errors: err.errors });
}

export function automationRoutes(ctx: RouteContext): Router {
  const router = Router();

  router.get('/api/automations', (_req, res) => {
    const service = ctx.automations;
    if (!service) return void fail(res, 503, 'automation service not available');
    ok(res, service.list());
  });

  router.post(
    '/api/automations',
    asyncHandler(async (req, res) => {
      const service = ctx.automations;
      if (!service) return void fail(res, 503, 'automation service not available');
      const parsed = AutomationBodySchema.safeParse(req.body);
      if (!parsed.success) return void fail(res, 400, parsed.error.message);
      try {
        ok(res, service.create(parsed.data));
      } catch (err) {
        if (err instanceof AutomationValidationError) return void failValidation(res, err);
        logger.error({ err }, 'create automation failed');
        fail(res, 500, err instanceof Error ? err.message : String(err));
      }
    }),
  );

  router.get('/api/automations/:id', (req, res) => {
    const service = ctx.automations;
    if (!service) return void fail(res, 503, 'automation service not available');
    const automation = service.get(param(req, 'id'));
    if (!automation) return void fail(res, 404, 'automation not found');
    ok(res, automation);
  });

  router.put(
    '/api/automations/:id',
    asyncHandler(async (req, res) => {
      const service = ctx.automations;
      if (!service) return void fail(res, 503, 'automation service not available');
      const id = param(req, 'id');
      if (!service.get(id)) return void fail(res, 404, 'automation not found');
      const parsed = AutomationBodySchema.safeParse(req.body);
      if (!parsed.success) return void fail(res, 400, parsed.error.message);
      try {
        ok(res, service.update(id, parsed.data));
      } catch (err) {
        if (err instanceof AutomationValidationError) return void failValidation(res, err);
        logger.error({ err, id }, 'update automation failed');
        fail(res, 500, err instanceof Error ? err.message : String(err));
      }
    }),
  );

  router.delete(
    '/api/automations/:id',
    asyncHandler(async (req, res) => {
      const service = ctx.automations;
      if (!service) return void fail(res, 503, 'automation service not available');
      const id = param(req, 'id');
      if (!service.get(id)) return void fail(res, 404, 'automation not found');
      await service.delete(id);
      okEmpty(res);
    }),
  );

  router.patch(
    '/api/automations/:id/enabled',
    asyncHandler(async (req, res) => {
      const service = ctx.automations;
      if (!service) return void fail(res, 503, 'automation service not available');
      const id = param(req, 'id');
      if (!service.get(id)) return void fail(res, 404, 'automation not found');
      const parsed = z.object({ enabled: z.boolean() }).safeParse(req.body);
      if (!parsed.success) return void fail(res, 400, parsed.error.message);
      ok(res, service.setEnabled(id, parsed.data.enabled));
    }),
  );

  router.post(
    '/api/automations/:id/runs',
    asyncHandler(async (req, res) => {
      const service = ctx.automations;
      if (!service) return void fail(res, 503, 'automation service not available');
      const id = param(req, 'id');
      if (!service.get(id)) return void fail(res, 404, 'automation not found');
      const run = service.runManually(id);
      res.status(202).json({ success: true, data: toRunSummary(run) });
    }),
  );

  router.get('/api/automations/:id/runs', (req, res) => {
    const service = ctx.automations;
    if (!service) return void fail(res, 503, 'automation service not available');
    ok(res, service.store.listRuns(param(req, 'id')).map(toRunSummary));
  });

  router.get('/api/automation-runs/:id', (req, res) => {
    const service = ctx.automations;
    if (!service) return void fail(res, 503, 'automation service not available');
    const run = service.store.getRun(param(req, 'id'));
    if (!run) return void fail(res, 404, 'run not found');
    ok(res, { run: toRunSummary(run), timeline: projectTimeline(run) });
  });

  router.post(
    '/api/automation-runs/:id/cancel',
    asyncHandler(async (req, res) => {
      const service = ctx.automations;
      if (!service) return void fail(res, 503, 'automation service not available');
      const id = param(req, 'id');
      if (!service.store.getRun(id)) return void fail(res, 404, 'run not found');
      await service.interpreter.cancelRun(id);
      okEmpty(res);
    }),
  );

  return router;
}
