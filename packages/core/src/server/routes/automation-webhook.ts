// packages/core/src/server/routes/automation-webhook.ts
//
// Task 25. POST /api/automation-webhooks/:hookId. Auth-exempt by path
// (server/middleware/auth.ts). Owns hookId lookup, header selection, and
// 404/401/204 responses per triggers/webhook.ts's own comment — that module
// stays pure/DB-primitive. Requires the RAW request body: http.ts must mount
// a path-scoped express.raw() ahead of the global express.json() (contract
// §4 — HMAC is computed over exact bytes, not a re-serialized JSON.parse).
import { Router } from 'express';
import type { AutomationDefinition } from '@qlan-ro/mainframe-types';
import type { RouteContext } from './types.js';
import { param } from './types.js';
import { fail, okEmpty } from './respond.js';
import { asyncHandler } from './async-handler.js';
import { createChildLogger } from '../../logger.js';
import { isDedupConflict } from '../../automations/service-helpers.js';
import {
  verifySignature,
  matchPreset,
  deliveryId,
  deliveryTimestampMs,
  isStaleDelivery,
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

      const timestampMs = deliveryTimestampMs(payload, req.headers as Record<string, string | string[] | undefined>);
      if (timestampMs !== null && isStaleDelivery(timestampMs, Date.now())) {
        logger.warn({ hookId, timestampMs }, 'stale webhook delivery dropped');
        res.status(204).end();
        return;
      }

      let delivery: string;
      try {
        delivery = deliveryId(payload, req.headers as Record<string, string | string[] | undefined>);
      } catch (err) {
        return void fail(res, 400, err instanceof Error ? err.message : String(err));
      }

      captureSample(service.db, found.row.id, found.trigger.id, payload);

      // Disabled automations stay a silent 200 (matches TriggerArmer.fireRun's
      // own enabled check) so a disabled automation's webhook doesn't leak its
      // existence via a differing status — findWebhookTrigger deliberately
      // includes disabled rows for the same reason.
      if (found.row.enabled === 1) {
        // Bypasses TriggerArmer.fireRun (which swallows every startRun error,
        // dedup or not, since its other callers have no HTTP response to fail)
        // so this route can tell the two apart: a duplicate delivery is a
        // no-op 200, any other failure to start the run is a 500 the sender
        // should retry (contract A7).
        try {
          const definition = JSON.parse(found.row.definition) as AutomationDefinition;
          const run = service.interpreter.startRun(
            found.row.id,
            definition,
            { kind: 'webhook', triggerId: found.trigger.id, payload },
            `${found.trigger.id}|${delivery}`,
          );
          void service.interpreter.advance(run.id).catch((err: unknown) => {
            logger.error({ err, runId: run.id }, 'webhook delivery: advance failed');
          });
        } catch (err) {
          if (!isDedupConflict(err)) {
            logger.error({ err, hookId }, 'webhook delivery failed to start a run');
            return void fail(res, 500, 'failed to start automation run');
          }
        }
      }
      okEmpty(res);
    }),
  );

  return router;
}
