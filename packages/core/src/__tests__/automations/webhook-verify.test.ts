// packages/core/src/__tests__/automations/webhook-verify.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  verifySignature,
  matchPreset,
  deliveryId,
  deliveryTimestampMs,
  isStaleDelivery,
  captureSample,
  GITHUB_PR_OPENED_PRESET,
  GITHUB_PR_MERGED_PRESET,
} from '../../automations/triggers/webhook.js';
import { openAutomationDb, type AutomationDb } from '../../automations/db.js';

const SECRET = 'shh-its-a-secret';

function sign(secret: string, rawBody: string): string {
  return `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;
}

describe('verifySignature', () => {
  it('passes for a correctly computed sha256= hex digest', () => {
    const rawBody = JSON.stringify({ action: 'opened' });
    expect(verifySignature(SECRET, rawBody, sign(SECRET, rawBody))).toBe(true);
  });

  it('fails for a tampered body', () => {
    const rawBody = JSON.stringify({ action: 'opened' });
    const header = sign(SECRET, rawBody);
    expect(verifySignature(SECRET, JSON.stringify({ action: 'closed' }), header)).toBe(false);
  });

  it('fails for a signature computed with the wrong secret', () => {
    const rawBody = JSON.stringify({ action: 'opened' });
    expect(verifySignature(SECRET, rawBody, sign('wrong-secret', rawBody))).toBe(false);
  });

  it('fails when the header is missing', () => {
    expect(verifySignature(SECRET, JSON.stringify({ action: 'opened' }), undefined)).toBe(false);
  });
});

describe('matchPreset', () => {
  it('PR-opened preset matches action:opened', () => {
    const payload = { event: 'pull_request', action: 'opened', pull_request: { html_url: 'https://x/1' } };
    expect(matchPreset(GITHUB_PR_OPENED_PRESET, payload)).toBe(true);
  });

  it('PR-opened preset ignores a synchronize delivery', () => {
    const payload = { event: 'pull_request', action: 'synchronize' };
    expect(matchPreset(GITHUB_PR_OPENED_PRESET, payload)).toBe(false);
  });

  it('PR-opened preset ignores a label edit delivery', () => {
    const payload = { event: 'pull_request', action: 'labeled' };
    expect(matchPreset(GITHUB_PR_OPENED_PRESET, payload)).toBe(false);
  });

  it('PR-merged preset matches a closed + merged delivery', () => {
    const payload = { event: 'pull_request', action: 'closed', pull_request: { merged: true } };
    expect(matchPreset(GITHUB_PR_MERGED_PRESET, payload)).toBe(true);
  });

  it('PR-merged preset does not match a closed delivery without merged:true', () => {
    const payload = { event: 'pull_request', action: 'closed', pull_request: { merged: false } };
    expect(matchPreset(GITHUB_PR_MERGED_PRESET, payload)).toBe(false);
  });
});

describe('deliveryId', () => {
  it('prefers the X-GitHub-Delivery header', () => {
    expect(deliveryId({ id: 'body-id' }, { 'x-github-delivery': 'header-id' })).toBe('header-id');
  });

  it('falls back to a payload.id field when the header is absent', () => {
    expect(deliveryId({ id: 'body-id' }, {})).toBe('body-id');
  });

  it('throws when neither the header nor payload.id is present', () => {
    expect(() => deliveryId({}, {})).toThrow(/delivery id/);
  });
});

describe('deliveryTimestampMs', () => {
  it('reads an X-Timestamp header in unix seconds', () => {
    expect(deliveryTimestampMs({}, { 'x-timestamp': '1700000000' })).toBe(1700000000 * 1000);
  });

  it('reads a top-level payload.timestamp field in unix milliseconds', () => {
    expect(deliveryTimestampMs({ timestamp: 1700000000123 }, {})).toBe(1700000000123);
  });

  it('reads an ISO 8601 payload.timestamp string', () => {
    expect(deliveryTimestampMs({ timestamp: '2023-11-14T22:13:20.000Z' }, {})).toBe(
      Date.parse('2023-11-14T22:13:20.000Z'),
    );
  });

  it('prefers the header over the payload field when both are present', () => {
    expect(deliveryTimestampMs({ timestamp: 1 }, { 'x-timestamp': '1700000000' })).toBe(1700000000 * 1000);
  });

  it('returns null when neither a header nor a payload field is derivable', () => {
    expect(deliveryTimestampMs({ action: 'opened' }, {})).toBeNull();
  });
});

describe('isStaleDelivery', () => {
  it('is not stale within the 10-minute window', () => {
    const now = 1_700_000_000_000;
    expect(isStaleDelivery(now - 9 * 60 * 1000, now)).toBe(false);
  });

  it('is stale just past the 10-minute window', () => {
    const now = 1_700_000_000_000;
    expect(isStaleDelivery(now - 11 * 60 * 1000, now)).toBe(true);
  });
});

describe('captureSample', () => {
  let dir: string;
  let db: AutomationDb;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'automations-webhook-'));
    db = openAutomationDb(join(dir, 'automations.db'));
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('stores the last payload for the trigger in trigger_state', () => {
    captureSample(db, 'auto-1', 'trigger-1', { action: 'opened' });
    const row = db
      .prepare(`SELECT last_payload FROM trigger_state WHERE automation_id = ? AND trigger_id = ?`)
      .get('auto-1', 'trigger-1') as { last_payload: string };
    expect(JSON.parse(row.last_payload)).toEqual({ action: 'opened' });
  });

  it('overwrites the previous sample on a later capture', () => {
    captureSample(db, 'auto-1', 'trigger-1', { action: 'opened' });
    captureSample(db, 'auto-1', 'trigger-1', { action: 'closed' });
    const row = db
      .prepare(`SELECT last_payload FROM trigger_state WHERE automation_id = ? AND trigger_id = ?`)
      .get('auto-1', 'trigger-1') as { last_payload: string };
    expect(JSON.parse(row.last_payload)).toEqual({ action: 'closed' });
  });
});
