import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import Database from 'better-sqlite3';
import { authRoutes } from '../auth.js';
import { DevicesRepository } from '../../../db/devices.js';

describe('auth routes', () => {
  let app: express.Express;
  const originalSecret = process.env.AUTH_TOKEN_SECRET;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use(authRoutes());
  });

  afterEach(() => {
    if (originalSecret !== undefined) {
      process.env.AUTH_TOKEN_SECRET = originalSecret;
    } else {
      delete process.env.AUTH_TOKEN_SECRET;
    }
  });

  it('POST /api/auth/pair initiates pairing', async () => {
    process.env.AUTH_TOKEN_SECRET = 'test-secret-at-least-32-characters-long!!';
    const res = await request(app).post('/api/auth/pair').send({ deviceName: 'My iPhone' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.pairingCode).toMatch(/^[A-Z0-9]{6}$/);
  });

  it('POST /api/auth/pair returns 400 when auth not configured', async () => {
    delete process.env.AUTH_TOKEN_SECRET;
    const res = await request(app).post('/api/auth/pair').send({ deviceName: 'My iPhone' });
    expect(res.status).toBe(400);
  });

  it('POST /api/auth/confirm exchanges code for token', async () => {
    process.env.AUTH_TOKEN_SECRET = 'test-secret-at-least-32-characters-long!!';

    const pairRes = await request(app).post('/api/auth/pair').send({ deviceName: 'My iPhone' });
    const { pairingCode } = pairRes.body.data;

    const confirmRes = await request(app).post('/api/auth/confirm').send({ pairingCode });
    expect(confirmRes.status).toBe(200);
    expect(confirmRes.body.data.token).toBeDefined();
  });

  it('POST /api/auth/confirm rejects invalid code', async () => {
    process.env.AUTH_TOKEN_SECRET = 'test-secret-at-least-32-characters-long!!';
    const res = await request(app).post('/api/auth/confirm').send({ pairingCode: 'INVALID' });
    expect(res.status).toBe(401);
  });

  it('GET /api/auth/status validates a token', async () => {
    process.env.AUTH_TOKEN_SECRET = 'test-secret-at-least-32-characters-long!!';

    const pairRes = await request(app).post('/api/auth/pair').send({ deviceName: 'Test' });
    const confirmRes = await request(app)
      .post('/api/auth/confirm')
      .send({ pairingCode: pairRes.body.data.pairingCode });
    const { token } = confirmRes.body.data;

    const statusRes = await request(app).get('/api/auth/status').set('Authorization', `Bearer ${token}`);
    expect(statusRes.status).toBe(200);
    expect(statusRes.body.data.valid).toBe(true);
  });

  it('GET /api/auth/status returns invalid for bad token', async () => {
    process.env.AUTH_TOKEN_SECRET = 'test-secret-at-least-32-characters-long!!';
    const res = await request(app).get('/api/auth/status').set('Authorization', 'Bearer bad-token');
    expect(res.body.data.valid).toBe(false);
  });

  describe('device endpoints', () => {
    let deviceDb: Database.Database;
    let devicesRepo: DevicesRepository;

    beforeEach(() => {
      deviceDb = new Database(':memory:');
      deviceDb.exec(`CREATE TABLE IF NOT EXISTS devices (
        device_id TEXT PRIMARY KEY, device_name TEXT NOT NULL,
        created_at TEXT NOT NULL, last_seen TEXT
      )`);
      devicesRepo = new DevicesRepository(deviceDb);
      app = express();
      app.use(express.json());
      app.use(authRoutes({ devicesRepo }));
    });

    afterEach(() => {
      deviceDb.close();
    });

    it('POST /api/auth/confirm persists device to DB', async () => {
      process.env.AUTH_TOKEN_SECRET = 'test-secret-at-least-32-characters-long!!';
      const pairRes = await request(app).post('/api/auth/pair').send({ deviceName: 'My iPhone' });
      await request(app).post('/api/auth/confirm').send({ pairingCode: pairRes.body.data.pairingCode });
      const devices = devicesRepo.getAll();
      expect(devices).toHaveLength(1);
      expect(devices[0]!.deviceName).toBe('My iPhone');
    });

    it('GET /api/auth/devices lists paired devices', async () => {
      devicesRepo.add('mobile-1', 'iPhone');
      devicesRepo.add('mobile-2', 'iPad');
      const res = await request(app).get('/api/auth/devices');
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);
    });

    it('DELETE /api/auth/devices/:deviceId removes a device', async () => {
      devicesRepo.add('mobile-1', 'iPhone');
      const res = await request(app).delete('/api/auth/devices/mobile-1');
      expect(res.status).toBe(200);
      expect(devicesRepo.getAll()).toHaveLength(0);
    });
  });
});
