import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { ProviderQuota } from '@qlan-ro/mainframe-types';
import { quotaRoutes } from '../quota.js';

function blob(usedPercent: number): ProviderQuota {
  return {
    status: 'ok',
    observedAt: 1_700_000_000_000,
    modelWindows: [],
    session: { kind: 'session', usedPercent, resetsAt: 1_700_010_000_000 },
    accountIdentity: 'uuid-1',
  };
}

function makeApp(quota?: unknown) {
  const app = express();
  app.use(express.json());
  app.use(quotaRoutes({ quota } as any));
  return app;
}

describe('GET /api/providers/:id/quota', () => {
  it('returns the merged blob in the ok envelope', async () => {
    const quota = { get: vi.fn().mockReturnValue(blob(42)) };
    const res = await request(makeApp(quota)).get('/api/providers/claude/quota');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.session.usedPercent).toBe(42);
    expect(quota.get).toHaveBeenCalledWith('claude');
  });

  it('returns an empty envelope when no quota is known', async () => {
    const quota = { get: vi.fn().mockReturnValue(undefined) };
    const res = await request(makeApp(quota)).get('/api/providers/claude/quota');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
  });

  it('rejects an id with illegal characters', async () => {
    const res = await request(makeApp({ get: vi.fn() })).get('/api/providers/cla%20ude/quota');
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });
});

describe('POST /api/providers/:id/quota/refresh', () => {
  it('refreshes and returns the updated blob', async () => {
    const quota = { get: vi.fn(), refresh: vi.fn().mockResolvedValue(blob(77)) };
    const res = await request(makeApp(quota)).post('/api/providers/claude/quota/refresh');
    expect(res.status).toBe(200);
    expect(res.body.data.session.usedPercent).toBe(77);
    expect(quota.refresh).toHaveBeenCalledWith('claude');
  });

  it('returns an empty envelope when refresh yields no blob', async () => {
    const quota = { get: vi.fn(), refresh: vi.fn().mockResolvedValue(undefined) };
    const res = await request(makeApp(quota)).post('/api/providers/codex/quota/refresh');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
  });

  it('503s when the quota service is unavailable', async () => {
    const res = await request(makeApp(undefined)).post('/api/providers/claude/quota/refresh');
    expect(res.status).toBe(503);
    expect(res.body.success).toBe(false);
  });
});
