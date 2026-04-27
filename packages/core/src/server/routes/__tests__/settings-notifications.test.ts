import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { settingRoutes } from '../settings.js';
import { NOTIFICATION_DEFAULTS } from '@qlan-ro/mainframe-types';

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

function makeApp(db = makeDb()) {
  const app = express();
  app.use(express.json());
  app.use(settingRoutes({ db, chats: {} as any, adapters: {} as any } as any));
  return { app, db };
}

describe('GET /api/settings/general — notifications', () => {
  it('returns default notification config when nothing is stored', async () => {
    const { app } = makeApp();
    const res = await request(app).get('/api/settings/general');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.notifications).toEqual(NOTIFICATION_DEFAULTS);
  });

  it('returns stored notification config merged with defaults', async () => {
    const stored = JSON.stringify({
      chat: { taskComplete: false, sessionError: true },
      permission: { toolRequest: true, userQuestion: false, planApproval: true },
      other: { plugin: false },
    });
    const db = makeDb({ 'general:notifications': stored });
    const { app } = makeApp(db);

    const res = await request(app).get('/api/settings/general');

    expect(res.status).toBe(200);
    expect(res.body.data.notifications.chat.taskComplete).toBe(false);
    expect(res.body.data.notifications.permission.userQuestion).toBe(false);
    expect(res.body.data.notifications.other.plugin).toBe(false);
  });

  it('falls back to defaults when stored value is invalid JSON', async () => {
    const db = makeDb({ 'general:notifications': 'not-json' });
    const { app } = makeApp(db);

    const res = await request(app).get('/api/settings/general');

    expect(res.status).toBe(200);
    expect(res.body.data.notifications).toEqual(NOTIFICATION_DEFAULTS);
  });
});

describe('PUT /api/settings/general — notifications', () => {
  it('persists a partial notifications patch', async () => {
    const { app, db } = makeApp();

    const res = await request(app)
      .put('/api/settings/general')
      .send({ notifications: { chat: { taskComplete: false, sessionError: true } } });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const stored = db.settings.get('general', 'notifications');
    expect(stored).not.toBeNull();
    const parsed = JSON.parse(stored!);
    expect(parsed.chat.taskComplete).toBe(false);
    expect(parsed.chat.sessionError).toBe(true);
    // unrelated groups should remain at defaults
    expect(parsed.permission).toEqual(NOTIFICATION_DEFAULTS.permission);
    expect(parsed.other).toEqual(NOTIFICATION_DEFAULTS.other);
  });

  it('merges subsequent patches rather than overwriting', async () => {
    const { app, db } = makeApp();

    await request(app)
      .put('/api/settings/general')
      .send({ notifications: { chat: { taskComplete: false, sessionError: true } } });

    await request(app)
      .put('/api/settings/general')
      .send({ notifications: { other: { plugin: false } } });

    const stored = db.settings.get('general', 'notifications');
    const parsed = JSON.parse(stored!);
    expect(parsed.chat.taskComplete).toBe(false);
    expect(parsed.other.plugin).toBe(false);
  });

  it('rejects invalid notification payload with 400', async () => {
    const { app } = makeApp();

    const res = await request(app)
      .put('/api/settings/general')
      .send({ notifications: { chat: { taskComplete: 'yes' } } });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });
});
