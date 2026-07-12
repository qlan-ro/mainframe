// packages/core/src/server/routes/__tests__/automation-webhook-route.test.ts
//
// Task 25. POST /api/automation-webhooks/:hookId end-to-end: raw-body HMAC
// verification, preset match, and delivery-id dedup. Mirrors http.ts's real
// middleware order (path-scoped express.raw BEFORE the global express.json,
// contract §4) so the raw Buffer the signature is computed over is exactly
// what the route sees.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import request from 'supertest';
import pino from 'pino';
import type { AutomationCreateInput } from '@qlan-ro/mainframe-types';
import { AutomationService } from '../../../automations/service.js';
import type { AgentChatPort } from '../../../automations/verbs/ask-agent.js';
import { automationWebhookRoutes } from '../automation-webhook.js';
import type { RouteContext } from '../types.js';

function fakeAgentPort(): AgentChatPort {
  return {
    async createChatAndSend() {
      return { chatId: 'stub-chat' };
    },
    async sendMessage() {},
  };
}

function makeCtx(service: AutomationService): RouteContext {
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    db: null as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    chats: null as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    adapters: null as any,
    automations: service,
  };
}

function sign(secret: string, rawBody: string): string {
  return `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;
}

function tick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

const PR_AUTOMATION: AutomationCreateInput = {
  name: 'PR auto-review',
  scope: 'global',
  definition: {
    triggers: [{ id: 'trig-1', kind: 'webhook', hookId: 'gh-hook', preset: 'github_pr_opened' }],
    steps: [{ id: 'notify-1', kind: 'notify', message: ['fired'] }],
  },
};

describe('automation webhook route', () => {
  let dir: string;
  let service: AutomationService;
  let app: express.Express;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'automations-webhook-route-'));
    service = new AutomationService({
      dataDir: dir,
      logger: pino({ level: 'silent' }),
      emitEvent: () => {},
      agentPort: fakeAgentPort(),
      listProjects: () => [],
    });
    app = express();
    // Path-scoped raw body BEFORE the global json parser — body-parser's
    // shared `req._body` flag makes express.json() skip an already-parsed
    // request, matching how http.ts must order these (contract §4).
    app.use('/api/automation-webhooks', express.raw({ type: '*/*' }));
    app.use(express.json());
    app.use(automationWebhookRoutes(makeCtx(service)));
  });

  afterEach(() => {
    service.stop();
    // create()'s webhook-secret write (credentials.ts) is fire-and-forget —
    // retry absorbs the rare race where that write is still landing when
    // cleanup runs, instead of a spurious ENOTEMPTY.
    rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 20 });
  });

  // supertest/superagent JSON-serializes a Buffer passed to `.send()` (its
  // own Buffer.toJSON()) rather than writing raw bytes — sending the exact
  // string with Content-Type already set to json is what preserves the byte
  // sequence the signature was computed over.
  function post(hookId: string, rawBody: string, headers: Record<string, string> = {}) {
    const req = request(app).post(`/api/automation-webhooks/${hookId}`).set('Content-Type', 'application/json');
    for (const [k, v] of Object.entries(headers)) req.set(k, v);
    return req.send(rawBody);
  }

  it('a valid sha256= signature without a Bearer token starts a run', async () => {
    const created = service.create(PR_AUTOMATION);
    const secret = service.credentials.get('webhook:gh-hook')?.token as string;
    const rawBody = JSON.stringify({ action: 'opened', pull_request: { html_url: 'https://x/1' } });

    const res = await post('gh-hook', rawBody, {
      'X-Hub-Signature-256': sign(secret, rawBody),
      'X-GitHub-Event': 'pull_request',
      'X-GitHub-Delivery': 'delivery-1',
    });
    expect(res.status).toBe(200);

    await tick();
    expect(service.store.listRuns(created.id)).toHaveLength(1);
  });

  it('an invalid signature is rejected with 401 and starts no run', async () => {
    const created = service.create(PR_AUTOMATION);
    const rawBody = JSON.stringify({ action: 'opened', pull_request: { html_url: 'https://x/1' } });

    const res = await post('gh-hook', rawBody, {
      'X-Hub-Signature-256': sign('wrong-secret', rawBody),
      'X-GitHub-Event': 'pull_request',
      'X-GitHub-Delivery': 'delivery-2',
    });
    expect(res.status).toBe(401);
    await tick();
    expect(service.store.listRuns(created.id)).toHaveLength(0);
  });

  it('a non-matching preset delivery returns 204 and starts no run', async () => {
    const created = service.create(PR_AUTOMATION);
    const secret = service.credentials.get('webhook:gh-hook')?.token as string;
    const rawBody = JSON.stringify({ action: 'synchronize', pull_request: { html_url: 'https://x/1' } });

    const res = await post('gh-hook', rawBody, {
      'X-Hub-Signature-256': sign(secret, rawBody),
      'X-GitHub-Event': 'pull_request',
      'X-GitHub-Delivery': 'delivery-3',
    });
    expect(res.status).toBe(204);
    await tick();
    expect(service.store.listRuns(created.id)).toHaveLength(0);
  });

  it('a duplicate delivery id starts exactly one run and both requests get 200', async () => {
    const created = service.create(PR_AUTOMATION);
    const secret = service.credentials.get('webhook:gh-hook')?.token as string;
    const rawBody = JSON.stringify({ action: 'opened', pull_request: { html_url: 'https://x/1' } });
    const headers = {
      'X-Hub-Signature-256': sign(secret, rawBody),
      'X-GitHub-Event': 'pull_request',
      'X-GitHub-Delivery': 'delivery-replay',
    };

    const first = await post('gh-hook', rawBody, headers);
    await tick();
    const second = await post('gh-hook', rawBody, headers);
    await tick();

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(service.store.listRuns(created.id)).toHaveLength(1);
  });

  it('a run-start failure other than a duplicate delivery returns 500 so the sender retries', async () => {
    service.create(PR_AUTOMATION);
    const secret = service.credentials.get('webhook:gh-hook')?.token as string;
    const rawBody = JSON.stringify({ action: 'opened', pull_request: { html_url: 'https://x/1' } });
    // Breaks only the run insert (trigger_state, used by captureSample, is untouched) so the
    // route sees a real non-constraint SqliteError distinct from a dedup unique-index conflict.
    service.db.exec('ALTER TABLE automation_runs RENAME TO automation_runs_disabled_for_test');

    const res = await post('gh-hook', rawBody, {
      'X-Hub-Signature-256': sign(secret, rawBody),
      'X-GitHub-Event': 'pull_request',
      'X-GitHub-Delivery': 'delivery-fail',
    });

    expect(res.status).toBe(500);
  });

  it('a stale timestamped delivery returns 204 and starts no run', async () => {
    const created = service.create(PR_AUTOMATION);
    const secret = service.credentials.get('webhook:gh-hook')?.token as string;
    const rawBody = JSON.stringify({ action: 'opened', pull_request: { html_url: 'https://x/1' } });
    const elevenMinutesAgo = Math.floor((Date.now() - 11 * 60 * 1000) / 1000);

    const res = await post('gh-hook', rawBody, {
      'X-Hub-Signature-256': sign(secret, rawBody),
      'X-GitHub-Event': 'pull_request',
      'X-GitHub-Delivery': 'delivery-stale',
      'X-Timestamp': String(elevenMinutesAgo),
    });
    expect(res.status).toBe(204);
    await tick();
    expect(service.store.listRuns(created.id)).toHaveLength(0);
  });

  it('an unknown hookId returns 404', async () => {
    const res = await post('no-such-hook', JSON.stringify({ action: 'opened' }));
    expect(res.status).toBe(404);
  });

  it('a webhook trigger with no preset fires on any verified delivery', async () => {
    const created = service.create({
      name: 'Any payload',
      scope: 'global',
      definition: {
        triggers: [{ id: 'trig-1', kind: 'webhook', hookId: 'any-hook' }],
        steps: [{ id: 'notify-1', kind: 'notify', message: ['fired'] }],
      },
    });
    const secret = service.credentials.get('webhook:any-hook')?.token as string;
    const rawBody = JSON.stringify({ anything: true });

    const res = await post('any-hook', rawBody, {
      'X-Signature': sign(secret, rawBody),
      'X-GitHub-Delivery': 'delivery-any',
    });
    expect(res.status).toBe(200);
    await tick();
    expect(service.store.listRuns(created.id)).toHaveLength(1);
  });
});
