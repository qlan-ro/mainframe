import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import Database from 'better-sqlite3';
import { createAuthMiddleware } from '../auth.js';
import { generateToken } from '../../../auth/token.js';
import { DevicesRepository } from '../../../db/devices.js';

describe('auth middleware', () => {
  const secret = 'test-secret-key-at-least-32-chars-long!!';

  function createApp(authSecret: string | null) {
    const app = express();
    app.set('trust proxy', 'loopback');
    app.use(createAuthMiddleware(authSecret));
    app.get('/test', (_req, res) => res.json({ success: true }));
    return app;
  }

  it('skips auth when no secret is configured', async () => {
    const app = createApp(null);
    const res = await request(app).get('/test');
    expect(res.status).toBe(200);
  });

  it('allows requests from localhost without token', async () => {
    const app = createApp(secret);
    // supertest defaults to 127.0.0.1
    const res = await request(app).get('/test');
    expect(res.status).toBe(200);
  });

  it('rejects non-localhost requests without token', async () => {
    const app = createApp(secret);
    const res = await request(app).get('/test').set('X-Forwarded-For', '192.168.1.100');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Unauthorized');
  });

  it('accepts non-localhost requests with valid token', async () => {
    const app = createApp(secret);
    const token = generateToken(secret, 'device-1');
    const res = await request(app)
      .get('/test')
      .set('X-Forwarded-For', '192.168.1.100')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
  });

  it('rejects non-localhost requests with invalid token', async () => {
    const app = createApp(secret);
    const res = await request(app)
      .get('/test')
      .set('X-Forwarded-For', '192.168.1.100')
      .set('Authorization', 'Bearer invalid-garbage');
    expect(res.status).toBe(401);
  });

  it('always allows unauthenticated auth routes without token', async () => {
    const app = express();
    app.set('trust proxy', 'loopback');
    app.use(createAuthMiddleware(secret));
    app.post('/api/auth/confirm', (_req, res) => res.json({ success: true }));
    const res = await request(app).post('/api/auth/confirm').set('X-Forwarded-For', '192.168.1.100');
    expect(res.status).toBe(200);
  });

  it('rejects /api/auth/pair from non-localhost', async () => {
    const app = express();
    app.set('trust proxy', 'loopback');
    app.use(createAuthMiddleware(secret));
    app.post('/api/auth/pair', (_req, res) => res.json({ success: true }));
    const res = await request(app).post('/api/auth/pair').set('X-Forwarded-For', '192.168.1.100');
    expect(res.status).toBe(401);
  });

  it('always allows /health without token', async () => {
    const app = express();
    app.set('trust proxy', 'loopback');
    app.use(createAuthMiddleware(secret));
    app.get('/health', (_req, res) => res.json({ status: 'ok' }));
    const res = await request(app).get('/health').set('X-Forwarded-For', '192.168.1.100');
    expect(res.status).toBe(200);
  });
});

describe('createAuthMiddleware with devicesRepo', () => {
  const SECRET = 'test-secret';
  let app: express.Express;
  let db: Database.Database;
  let devices: DevicesRepository;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE devices (
        device_id TEXT PRIMARY KEY, device_name TEXT NOT NULL, created_at TEXT NOT NULL,
        last_seen TEXT, auth_epoch INTEGER NOT NULL DEFAULT 0
      )
    `);
    devices = new DevicesRepository(db);
    app = express();
    app.set('trust proxy', 'loopback');
    app.use(createAuthMiddleware(SECRET, devices));
    app.get('/protected', (req, res) => {
      res.json({ deviceId: req.auth?.deviceId ?? null });
    });
  });

  afterEach(() => db.close());

  it('401 when token is for a deleted device', async () => {
    const token = generateToken(SECRET, 'mobile-ghost', 1);
    const res = await request(app)
      .get('/protected')
      .set('X-Forwarded-For', '1.2.3.4')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
  });

  it('401 when token epoch is stale', async () => {
    devices.add('mobile-1', 'iPhone');
    const old = devices.incrementAuthEpoch('mobile-1');
    devices.incrementAuthEpoch('mobile-1');
    const token = generateToken(SECRET, 'mobile-1', old);
    const res = await request(app)
      .get('/protected')
      .set('X-Forwarded-For', '1.2.3.4')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
  });

  it('200 with req.auth populated when valid', async () => {
    devices.add('mobile-1', 'iPhone');
    const epoch = devices.incrementAuthEpoch('mobile-1');
    const token = generateToken(SECRET, 'mobile-1', epoch);
    const res = await request(app)
      .get('/protected')
      .set('X-Forwarded-For', '1.2.3.4')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.deviceId).toBe('mobile-1');
  });

  it('localhost without header passes without req.auth', async () => {
    const res = await request(app).get('/protected');
    expect(res.status).toBe(200);
    expect(res.body.deviceId).toBeNull();
  });

  it('localhost with valid header populates req.auth', async () => {
    devices.add('mobile-1', 'iPhone');
    const epoch = devices.incrementAuthEpoch('mobile-1');
    const token = generateToken(SECRET, 'mobile-1', epoch);
    const res = await request(app).get('/protected').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.deviceId).toBe('mobile-1');
  });

  it('localhost with invalid header passes without req.auth', async () => {
    const res = await request(app).get('/protected').set('Authorization', 'Bearer garbage');
    expect(res.status).toBe(200);
    expect(res.body.deviceId).toBeNull();
  });
});
