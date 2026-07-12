// packages/core/src/automations/triggers/webhook.ts
//
// Task 22: webhook trigger primitives — signature verification, preset
// predicates, replay-dedup delivery ids, and last-payload sampling. The
// route (Task 25) owns hookId lookup, header selection, and 404/401/204
// responses; this module is pure/DB-primitive so it is unit-testable
// without an HTTP layer.
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { AutomationDb } from '../db.js';

/**
 * HMAC-SHA256 over the raw request body, encoded exactly as GitHub's
 * `sha256=<lowercase-hex>` form. `header` is whichever of `X-Signature` /
 * `X-Hub-Signature-256` the caller found — this function is header-name
 * agnostic, it only compares the value.
 */
export function verifySignature(secret: string, rawBody: string | Buffer, header: string | undefined): boolean {
  if (!header) return false;
  const expected = `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;
  const expectedBuf = Buffer.from(expected);
  const headerBuf = Buffer.from(header);
  if (expectedBuf.length !== headerBuf.length) return false;
  return timingSafeEqual(expectedBuf, headerBuf);
}

/**
 * A webhook preset's server-side match predicate (contract §4). The route
 * layer merges the delivery's event type (`X-GitHub-Event`) into the parsed
 * body under `event` before calling `matchPreset`; `merged` checks the
 * nested `pull_request.merged` field GitHub actually sends on `closed`.
 */
export interface WebhookPresetPredicate {
  event: string;
  action?: string;
  merged?: boolean;
}

export const GITHUB_PR_OPENED_PRESET: WebhookPresetPredicate = { event: 'pull_request', action: 'opened' };
export const GITHUB_PR_MERGED_PRESET: WebhookPresetPredicate = {
  event: 'pull_request',
  action: 'closed',
  merged: true,
};

export function matchPreset(preset: WebhookPresetPredicate, payload: unknown): boolean {
  if (typeof payload !== 'object' || payload === null) return false;
  const body = payload as Record<string, unknown>;
  if (body.event !== preset.event) return false;
  if (preset.action !== undefined && body.action !== preset.action) return false;
  if (preset.merged !== undefined && readMerged(body) !== preset.merged) return false;
  return true;
}

function readMerged(body: Record<string, unknown>): boolean {
  const pr = body.pull_request;
  return typeof pr === 'object' && pr !== null && (pr as Record<string, unknown>).merged === true;
}

/**
 * Replay-dedup key (contract §4): prefers `X-GitHub-Delivery`, falls back to
 * a required `id` field on the payload. Throws when neither is present —
 * the route treats that as a malformed delivery, not a silent no-dedup pass.
 */
export function deliveryId(payload: unknown, headers: Record<string, string | string[] | undefined>): string {
  const header = headers['x-github-delivery'];
  if (typeof header === 'string' && header.length > 0) return header;

  if (typeof payload === 'object' && payload !== null) {
    const id = (payload as Record<string, unknown>).id;
    if (typeof id === 'string' && id.length > 0) return id;
    if (typeof id === 'number') return String(id);
  }

  throw new Error('webhook delivery missing a delivery id (X-GitHub-Delivery header or payload.id)');
}

const STALE_WINDOW_MS = 10 * 60 * 1000;

/**
 * A delivery's client-asserted send time, when the sender provides one
 * (contract §4's bounded staleness window applies only where a timestamp is
 * derivable). GitHub's generic webhook delivery carries no such field —
 * `X-GitHub-Delivery` is a replay-dedup id, not a clock reading — so this
 * covers senders that do send one: an `X-Timestamp` header, or a top-level
 * `timestamp` payload field, accepted as unix seconds, unix milliseconds, or
 * an ISO 8601 string. Returns null when neither is present; the route then
 * falls back to the permanent delivery-id unique index (webhook.ts's
 * `deliveryId`), which is a *stronger* defense for ids it has already seen
 * than any bounded window could be.
 */
export function deliveryTimestampMs(
  payload: unknown,
  headers: Record<string, string | string[] | undefined>,
): number | null {
  const header = headers['x-timestamp'];
  const fromHeader = parseTimestamp(Array.isArray(header) ? header[0] : header);
  if (fromHeader !== null) return fromHeader;

  if (typeof payload === 'object' && payload !== null) {
    const fromPayload = parseTimestamp((payload as Record<string, unknown>).timestamp);
    if (fromPayload !== null) return fromPayload;
  }
  return null;
}

function parseTimestamp(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return normalizeEpoch(value);
  if (typeof value === 'string' && value.length > 0) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return normalizeEpoch(numeric);
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return null;
}

/** Bare epoch numbers below this are unix *seconds* (Stripe/Slack's convention) — a millisecond timestamp is always well above it for any date this app will see. */
function normalizeEpoch(value: number): number {
  return value < 1e12 ? value * 1000 : value;
}

/** contract §4's 10-minute bounded staleness window. */
export function isStaleDelivery(timestampMs: number, now: number): boolean {
  return now - timestampMs > STALE_WINDOW_MS;
}

/** Stores the last payload for the trigger in `trigger_state.last_payload` (engine-internal, contract §3). */
export function captureSample(db: AutomationDb, automationId: string, triggerId: string, payload: unknown): void {
  db.prepare(
    `INSERT INTO trigger_state (automation_id, trigger_id, last_payload) VALUES (?, ?, ?)
     ON CONFLICT(automation_id, trigger_id) DO UPDATE SET last_payload = excluded.last_payload`,
  ).run(automationId, triggerId, JSON.stringify(payload));
}
