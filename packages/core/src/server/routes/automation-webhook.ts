// packages/core/src/server/routes/automation-webhook.ts
//
// Task 25. POST /api/automation-webhooks/:hookId. Auth-exempt by path
// (server/middleware/auth.ts). Owns hookId lookup, header selection, and
// 404/401/204 responses per triggers/webhook.ts's own comment — that module
// stays pure/DB-primitive. Requires the RAW request body: http.ts must mount
// a path-scoped express.raw() ahead of the global express.json() (contract
// §4 — HMAC is computed over exact bytes, not a re-serialized JSON.parse).
import { Router } from 'express';
import type { RouteContext } from './types.js';
import { param } from './types.js';
import { fail, okEmpty } from './respond.js';
import { asyncHandler } from './async-handler.js';
import { createChildLogger } from '../../logger.js';
import {
  verifySignature,
  matchPreset,
  deliveryId,
  captureSample,
  GITHUB_PR_OPENED_PRESET,
  GITHUB_PR_MERGED_PRESET,
  type WebhookPresetPredicate,
} from '../../automations/triggers/webhook.js';

const logger = createChildLogger('routes:automation-webhook');

const PRESET_BY_NAME: Record<string, WebhookPresetPredicate> = {
  github_pr_opened: GITHUB_PR_OPENED_PRESET,
  github_pr_merged: GITHUB_PR_MERGED_PRESET,
};

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function automationWebhookRoutes(ctx: RouteContext): Router {
  const router = Router();

  router.post(
    '/api/automation-webhooks/:hookId',
    asyncHandler(async (req, res) => {
      const service = ctx.automations;
      if (!service) return void fail(res, 503, 'automation service not available');
      const hookId = param(req, 'hookId');

      const found = service.automations.findWebhookTrigger(hookId);
      if (!found) return void fail(res, 404, 'unknown webhook');

      const rawBody = req.body as Buffer;
      const sigHeader = firstHeader(req.headers['x-hub-signature-256']) ?? firstHeader(req.headers['x-signature']);
      const secret = service.credentials.get(`webhook:${hookId}`);
      if (!secret || !verifySignature(secret.token, rawBody, sigHeader)) {
        return void fail(res, 401, 'invalid signature');
      }

      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(rawBody.toString('utf8')) as Record<string, unknown>;
      } catch {
        return void fail(res, 400, 'invalid JSON payload');
      }
      const githubEvent = firstHeader(req.headers['x-github-event']);
      if (githubEvent) payload.event = githubEvent;

      const preset = found.trigger.preset ? PRESET_BY_NAME[found.trigger.preset] : undefined;
      if (preset && !matchPreset(preset, payload)) {
        res.status(204).end();
        return;
      }

      let delivery: string;
      try {
        delivery = deliveryId(payload, req.headers as Record<string, string | string[] | undefined>);
      } catch (err) {
        return void fail(res, 400, err instanceof Error ? err.message : String(err));
      }

      try {
        captureSample(service.db, found.row.id, found.trigger.id, payload);
        service.triggers.fireRun(
          found.row.id,
          { kind: 'webhook', triggerId: found.trigger.id, payload },
          `${found.trigger.id}|${delivery}`,
        );
      } catch (err) {
        logger.error({ err, hookId }, 'webhook delivery failed to start a run');
      }
      okEmpty(res);
    }),
  );

  return router;
}
