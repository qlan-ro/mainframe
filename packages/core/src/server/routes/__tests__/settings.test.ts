import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { settingRoutes } from '../settings.js';
import { GENERAL_DEFAULTS } from '@qlan-ro/mainframe-types';

vi.mock('../../../adapters/resolve-executable.js', () => ({
  resolveAdapterExecutableCached: vi.fn(async (adapterId: string) => ({
    path: `/usr/local/bin/${adapterId}`,
    source: 'detected',
    valid: true,
    version: '1.2.3',
  })),
  defaultRun: vi.fn(),
}));

function makeDb(initial: Record<string, string> = {}) {
  const store: Record<string, string> = { ...initial };
  return {
    settings: {
      get: (cat: string, key: string) => store[`${cat}:${key}`] ?? null,
      getByCategory: (cat: string) => {
        const result: Record<string, string> = {};
        for (const [k, v] of Object.entries(store)) {
          if (k.startsWith(`${cat}:`)) result[k.slice(cat.length + 1)] = v;
        }
        return result;
      },
      set: (cat: string, key: string, value: string) => {
        store[`${cat}:${key}`] = value;
      },
      delete: (cat: string, key: string) => {
        delete store[`${cat}:${key}`];
      },
    },
  };
}

function makeApp(db = makeDb(), adapterIds: string[] = ['claude']) {
  const app = express();
  app.use(express.json());
  const adapters = {
    getAll: () => adapterIds.map((id) => ({ id })),
    // main's #441 providers route normalizes saved defaultModels against the live catalog.
    getSnapshots: () => adapterIds.map((id) => ({ id, models: [] })),
  };
  app.use(settingRoutes({ db, chats: {} as any, adapters } as any));
  return { app, db };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/settings/general', () => {
  it('returns defaults when nothing is stored', async () => {
    const { app } = makeApp();
    const res = await request(app).get('/api/settings/general');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: GENERAL_DEFAULTS });
  });

  it('returns stored worktreeDir override', async () => {
    const db = makeDb({ 'general:worktreeDir': 'my-worktrees' });
    const { app } = makeApp(db);
    const res = await request(app).get('/api/settings/general');
    expect(res.status).toBe(200);
    expect(res.body.data.worktreeDir).toBe('my-worktrees');
  });

  it('returns the stored defaultAdapterId override', async () => {
    const db = makeDb({ 'general:defaultAdapterId': 'codex' });
    const { app } = makeApp(db);
    const res = await request(app).get('/api/settings/general');
    expect(res.status).toBe(200);
    expect(res.body.data.defaultAdapterId).toBe('codex');
  });
});

describe('PUT /api/settings/general', () => {
  it('persists a non-default worktreeDir', async () => {
    const { app, db } = makeApp();
    const res = await request(app).put('/api/settings/general').send({ worktreeDir: 'custom-dir' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(db.settings.get('general', 'worktreeDir')).toBe('custom-dir');
  });

  it('deletes the stored key when set back to the default value', async () => {
    const db = makeDb({ 'general:worktreeDir': 'custom-dir' });
    const { app } = makeApp(db);
    const res = await request(app).put('/api/settings/general').send({ worktreeDir: '.worktrees' });
    expect(res.status).toBe(200);
    expect(db.settings.get('general', 'worktreeDir')).toBeNull();
  });

  it('rejects a worktreeDir containing path separators', async () => {
    const { app } = makeApp();
    const res = await request(app).put('/api/settings/general').send({ worktreeDir: '../escape' });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('persists a defaultAdapterId', async () => {
    const { app, db } = makeApp();
    const res = await request(app).put('/api/settings/general').send({ defaultAdapterId: 'gemini' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(db.settings.get('general', 'defaultAdapterId')).toBe('gemini');
  });

  it('deletes the stored defaultAdapterId when set back to null', async () => {
    const db = makeDb({ 'general:defaultAdapterId': 'gemini' });
    const { app } = makeApp(db);
    const res = await request(app).put('/api/settings/general').send({ defaultAdapterId: null });
    expect(res.status).toBe(200);
    expect(db.settings.get('general', 'defaultAdapterId')).toBeNull();
  });

  it('rejects a defaultAdapterId with invalid characters', async () => {
    const { app } = makeApp();
    const res = await request(app).put('/api/settings/general').send({ defaultAdapterId: '../escape' });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });
});

describe('GET /api/settings/providers', () => {
  it('returns resolved executables for every known adapter', async () => {
    const { app } = makeApp(makeDb(), ['claude', 'codex']);
    const res = await request(app).get('/api/settings/providers');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      data: {
        claude: {
          resolvedExecutable: { path: '/usr/local/bin/claude', source: 'detected', valid: true, version: '1.2.3' },
        },
        codex: {
          resolvedExecutable: { path: '/usr/local/bin/codex', source: 'detected', valid: true, version: '1.2.3' },
        },
      },
    });
  });

  it('maps skipPermissions=true without an explicit defaultMode to yolo and strips skipPermissions', async () => {
    const db = makeDb({ 'provider:claude.skipPermissions': 'true' });
    const { app } = makeApp(db, ['claude']);
    const res = await request(app).get('/api/settings/providers');

    expect(res.status).toBe(200);
    expect(res.body.data.claude.defaultMode).toBe('yolo');
    expect(res.body.data.claude.skipPermissions).toBeUndefined();
  });

  it('includes an adapter with only stored settings and no registered adapter entry', async () => {
    const db = makeDb({ 'provider:ghost.defaultModel': 'gpt-ghost' });
    const { app } = makeApp(db, ['claude']);
    const res = await request(app).get('/api/settings/providers');

    expect(res.status).toBe(200);
    expect(res.body.data.ghost.defaultModel).toBe('gpt-ghost');
    expect(res.body.data.ghost.resolvedExecutable).toEqual({
      path: '/usr/local/bin/ghost',
      source: 'detected',
      valid: true,
      version: '1.2.3',
    });
  });
});

describe('PUT /api/settings/providers/:adapterId', () => {
  it('sets a defaultModel', async () => {
    const { app, db } = makeApp();
    const res = await request(app).put('/api/settings/providers/claude').send({ defaultModel: 'opus' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(db.settings.get('provider', 'claude.defaultModel')).toBe('opus');
  });

  it('clears a setting when the value is empty string', async () => {
    const db = makeDb({ 'provider:claude.defaultEffort': 'high' });
    const { app } = makeApp(db);
    const res = await request(app).put('/api/settings/providers/claude').send({ defaultEffort: '' });
    expect(res.status).toBe(200);
    expect(db.settings.get('provider', 'claude.defaultEffort')).toBeNull();
  });

  it('clears skipPermissions when defaultMode is set explicitly', async () => {
    const db = makeDb({ 'provider:claude.skipPermissions': 'true' });
    const { app } = makeApp(db);
    const res = await request(app).put('/api/settings/providers/claude').send({ defaultMode: 'acceptEdits' });
    expect(res.status).toBe(200);
    expect(db.settings.get('provider', 'claude.defaultMode')).toBe('acceptEdits');
    expect(db.settings.get('provider', 'claude.skipPermissions')).toBeNull();
  });

  it('rejects an invalid defaultMode enum value with 400', async () => {
    const { app } = makeApp();
    const res = await request(app).put('/api/settings/providers/claude').send({ defaultMode: 'bogus-mode' });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('rejects an invalid defaultEffort enum value with 400', async () => {
    const { app } = makeApp();
    const res = await request(app).put('/api/settings/providers/claude').send({ defaultEffort: 'ultra' });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });
});
