import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import Database from 'better-sqlite3';
import { authRoutes, _resetAuthState } from '../auth.js';
import { createAuthMiddleware } from '../../middleware/auth.js';
import { DevicesRepository } from '../../../db/devices.js';
import { generateToken } from '../../../auth/token.js';

const SECRET = 'test-secret-at-least-32-characters-long!!';

describe('auth routes', () => {
  let app: express.Express;
  const originalSecret = process.env.AUTH_TOKEN_SECRET;

  beforeEach(() => {
    _resetAuthState();
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
    process.env.AUTH_TOKEN_SECRET = SECRET;
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

  it('POST /api/auth/confirm rejects invalid code', async () => {
    process.env.AUTH_TOKEN_SECRET = SECRET;
    const uuid = '11111111-2222-4333-8444-555555555555';
    const res = await request(app).post('/api/auth/confirm').send({ pairingCode: 'INVALID', clientDeviceId: uuid });
    expect(res.status).toBe(401);
  });

  it('POST /api/auth/confirm rate-limits after too many failures', async () => {
    process.env.AUTH_TOKEN_SECRET = SECRET;
    const uuid = '11111111-2222-4333-8444-555555555555';
    for (let i = 0; i < 10; i++) {
      await request(app)
        .post('/api/auth/confirm')
        .send({ pairingCode: 'WRONG' + i, clientDeviceId: uuid });
    }
    const res = await request(app).post('/api/auth/confirm').send({ pairingCode: 'WRONG99', clientDeviceId: uuid });
    expect(res.status).toBe(429);
  });

  it('GET /api/auth/status returns invalid for bad token', async () => {
    process.env.AUTH_TOKEN_SECRET = SECRET;
    const res = await request(app).get('/api/auth/status').set('Authorization', 'Bearer bad-token');
    expect(res.body.data.valid).toBe(false);
  });

  describe('GET /api/auth/pair-status', () => {
    it('returns paired:false before consumption', async () => {
      const res = await request(app).get('/api/auth/pair-status?code=ABC123');
      expect(res.status).toBe(200);
      expect(res.body.data.paired).toBe(false);
    });

    it('returns 400 on malformed code', async () => {
      const res = await request(app).get('/api/auth/pair-status?code=bad!');
      expect(res.status).toBe(400);
    });
  });

  describe('device endpoints', () => {
    let deviceDb: Database.Database;
    let devicesRepo: DevicesRepository;

    beforeEach(() => {
      process.env.AUTH_TOKEN_SECRET = SECRET;
      deviceDb = new Database(':memory:');
      deviceDb.exec(`CREATE TABLE IF NOT EXISTS devices (
        device_id TEXT PRIMARY KEY, device_name TEXT NOT NULL,
        created_at TEXT NOT NULL, last_seen TEXT,
        auth_epoch INTEGER NOT NULL DEFAULT 0
      )`);
      devicesRepo = new DevicesRepository(deviceDb);
      app = express();
      app.set('trust proxy', 'loopback');
      app.use(express.json());
      app.use(createAuthMiddleware(SECRET, devicesRepo));
      app.use(authRoutes({ devicesRepo }));
    });

    afterEach(() => {
      deviceDb.close();
    });

    it('POST /api/auth/confirm exchanges code for token', async () => {
      const uuid = '11111111-2222-4333-8444-555555555555';
      const pairRes = await request(app).post('/api/auth/pair').send({ deviceName: 'My iPhone' });
      const { pairingCode } = pairRes.body.data;

      const confirmRes = await request(app).post('/api/auth/confirm').send({ pairingCode, clientDeviceId: uuid });
      expect(confirmRes.status).toBe(200);
      expect(confirmRes.body.data.token).toBeDefined();
    });

    it('POST /api/auth/confirm accepts deviceName from mobile', async () => {
      const uuid = '11111111-2222-4333-8444-555555555555';
      const pairRes = await request(app).post('/api/auth/pair').send({});
      const confirmRes = await request(app)
        .post('/api/auth/confirm')
        .send({ pairingCode: pairRes.body.data.pairingCode, deviceName: 'iOS device', clientDeviceId: uuid });
      expect(confirmRes.status).toBe(200);
      expect(confirmRes.body.data.token).toBeDefined();
    });

    it('POST /api/auth/confirm persists device to DB with name from mobile', async () => {
      const uuid = '11111111-2222-4333-8444-555555555555';
      const pairRes = await request(app).post('/api/auth/pair').send({});
      await request(app)
        .post('/api/auth/confirm')
        .send({ pairingCode: pairRes.body.data.pairingCode, deviceName: 'My iPhone', clientDeviceId: uuid });
      const devices = devicesRepo.getAll();
      expect(devices).toHaveLength(1);
      expect(devices[0]!.deviceName).toBe('My iPhone');
    });

    it('GET /api/auth/status validates a token', async () => {
      const uuid = '11111111-2222-4333-8444-555555555555';
      devicesRepo.add(`mobile-${uuid}`, 'iPhone');
      const epoch = devicesRepo.incrementAuthEpoch(`mobile-${uuid}`);
      const token = generateToken(SECRET, `mobile-${uuid}`, epoch);

      const statusRes = await request(app).get('/api/auth/status').set('Authorization', `Bearer ${token}`);
      expect(statusRes.status).toBe(200);
      expect(statusRes.body.data.valid).toBe(true);
    });

    it('GET /api/auth/devices lists paired devices', async () => {
      devicesRepo.add('mobile-1', 'iPhone');
      devicesRepo.add('mobile-2', 'iPad');
      const res = await request(app)
        .get('/api/auth/devices')
        .set('X-Forwarded-For', '1.2.3.4')
        .set(
          'Authorization',
          `Bearer ${generateToken(SECRET, 'mobile-1', devicesRepo.incrementAuthEpoch('mobile-1'))}`,
        );
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);
    });

    it('DELETE /api/auth/devices/:deviceId removes a device', async () => {
      devicesRepo.add('mobile-1', 'iPhone');
      const epoch = devicesRepo.incrementAuthEpoch('mobile-1');
      const token = generateToken(SECRET, 'mobile-1', epoch);
      const res = await request(app)
        .delete('/api/auth/devices/mobile-1')
        .set('X-Forwarded-For', '1.2.3.4')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(devicesRepo.getAll()).toHaveLength(0);
    });

    describe('POST /api/auth/confirm with clientDeviceId', () => {
      it('returns mobile-<uuid> deviceId; second pair with same UUID returns same id', async () => {
        const uuid = '11111111-2222-4333-8444-555555555555';
        const p1 = await request(app).post('/api/auth/pair');
        const c1 = await request(app).post('/api/auth/confirm').send({
          pairingCode: p1.body.data.pairingCode,
          deviceName: 'iPhone',
          clientDeviceId: uuid,
        });
        expect(c1.status).toBe(200);
        expect(c1.body.data.deviceId).toBe(`mobile-${uuid}`);

        const p2 = await request(app).post('/api/auth/pair');
        const c2 = await request(app).post('/api/auth/confirm').send({
          pairingCode: p2.body.data.pairingCode,
          deviceName: 'iPhone Renamed',
          clientDeviceId: uuid,
        });
        expect(c2.body.data.deviceId).toBe(`mobile-${uuid}`);
        expect(devicesRepo.getAll()).toHaveLength(1);
      });

      it('previous token is rejected after re-pair (epoch bumped)', async () => {
        const uuid = '11111111-2222-4333-8444-555555555555';
        const p1 = await request(app).post('/api/auth/pair');
        const c1 = await request(app).post('/api/auth/confirm').send({
          pairingCode: p1.body.data.pairingCode,
          deviceName: 'iPhone',
          clientDeviceId: uuid,
        });
        const oldToken = c1.body.data.token;

        const p2 = await request(app).post('/api/auth/pair');
        await request(app).post('/api/auth/confirm').send({
          pairingCode: p2.body.data.pairingCode,
          deviceName: 'iPhone',
          clientDeviceId: uuid,
        });

        const probe = await request(app)
          .get('/api/auth/devices')
          .set('X-Forwarded-For', '1.2.3.4')
          .set('Authorization', `Bearer ${oldToken}`);
        expect(probe.status).toBe(401);
      });

      it('400 without clientDeviceId', async () => {
        const pair = await request(app).post('/api/auth/pair');
        const res = await request(app).post('/api/auth/confirm').send({
          pairingCode: pair.body.data.pairingCode,
          deviceName: 'iPhone',
        });
        expect(res.status).toBe(400);
      });

      it('400 with malformed clientDeviceId', async () => {
        const pair = await request(app).post('/api/auth/pair');
        const res = await request(app).post('/api/auth/confirm').send({
          pairingCode: pair.body.data.pairingCode,
          deviceName: 'iPhone',
          clientDeviceId: 'not-a-uuid',
        });
        expect(res.status).toBe(400);
      });

      it('records the pairing so /pair-status returns paired:true', async () => {
        const uuid = '11111111-2222-4333-8444-555555555555';
        const pair = await request(app).post('/api/auth/pair');
        const code = pair.body.data.pairingCode;
        await request(app).post('/api/auth/confirm').send({
          pairingCode: code,
          deviceName: 'My iPhone',
          clientDeviceId: uuid,
        });
        const status = await request(app).get(`/api/auth/pair-status?code=${code}`);
        expect(status.body.data).toMatchObject({
          paired: true,
          deviceId: `mobile-${uuid}`,
          deviceName: 'My iPhone',
        });
      });
    });

    describe('GET /api/auth/status with device validation', () => {
      it('returns valid:false for a token whose device row is missing', async () => {
        const token = generateToken(SECRET, 'mobile-ghost', 1);
        const res = await request(app).get('/api/auth/status').set('Authorization', `Bearer ${token}`);
        expect(res.body.data.valid).toBe(false);
      });

      it('returns valid:false for stale-epoch token', async () => {
        devicesRepo.add('mobile-1', 'iPhone');
        const oldEpoch = devicesRepo.incrementAuthEpoch('mobile-1');
        devicesRepo.incrementAuthEpoch('mobile-1');
        const token = generateToken(SECRET, 'mobile-1', oldEpoch);
        const res = await request(app).get('/api/auth/status').set('Authorization', `Bearer ${token}`);
        expect(res.body.data.valid).toBe(false);
      });
    });

    describe('POST /api/auth/register-push auth', () => {
      it('401 without bearer token from non-localhost', async () => {
        const res = await request(app)
          .post('/api/auth/register-push')
          .set('X-Forwarded-For', '1.2.3.4')
          .send({ deviceId: 'mobile-x', pushToken: 'tok' });
        expect(res.status).toBe(401);
      });

      it('403 when body.deviceId does not match token', async () => {
        devicesRepo.add('mobile-a', 'A');
        const epoch = devicesRepo.incrementAuthEpoch('mobile-a');
        const token = generateToken(SECRET, 'mobile-a', epoch);
        const res = await request(app)
          .post('/api/auth/register-push')
          .set('X-Forwarded-For', '1.2.3.4')
          .set('Authorization', `Bearer ${token}`)
          .send({ deviceId: 'mobile-b', pushToken: 'tok' });
        expect(res.status).toBe(403);
      });

      it('200 when authenticated and matching', async () => {
        devicesRepo.add('mobile-a', 'A');
        const epoch = devicesRepo.incrementAuthEpoch('mobile-a');
        const token = generateToken(SECRET, 'mobile-a', epoch);
        const res = await request(app)
          .post('/api/auth/register-push')
          .set('X-Forwarded-For', '1.2.3.4')
          .set('Authorization', `Bearer ${token}`)
          .send({ deviceId: 'mobile-a', pushToken: 'tok' });
        expect(res.status).toBe(200);
      });

      it('localhost without bearer returns 401', async () => {
        const res = await request(app).post('/api/auth/register-push').send({ deviceId: 'mobile-x', pushToken: 'tok' });
        expect(res.status).toBe(401);
      });

      it('localhost with valid bearer returns 200', async () => {
        devicesRepo.add('mobile-a', 'A');
        const epoch = devicesRepo.incrementAuthEpoch('mobile-a');
        const token = generateToken(SECRET, 'mobile-a', epoch);
        const res = await request(app)
          .post('/api/auth/register-push')
          .set('Authorization', `Bearer ${token}`)
          .send({ deviceId: 'mobile-a', pushToken: 'tok' });
        expect(res.status).toBe(200);
      });
    });

    describe('DELETE /api/auth/devices/:deviceId calls unregisterDevice', () => {
      it('calls pushService.unregisterDevice', async () => {
        const calls: string[] = [];
        const fakePush = {
          registerDevice() {},
          unregisterDevice(id: string) {
            calls.push(id);
          },
        };
        const localApp = express();
        localApp.set('trust proxy', 'loopback');
        localApp.use(express.json());
        localApp.use(createAuthMiddleware(SECRET, devicesRepo));
        localApp.use(authRoutes({ devicesRepo, pushService: fakePush as any }));

        devicesRepo.add('mobile-a', 'A');
        const epoch = devicesRepo.incrementAuthEpoch('mobile-a');
        const token = generateToken(SECRET, 'mobile-a', epoch);
        await request(localApp)
          .delete('/api/auth/devices/mobile-a')
          .set('X-Forwarded-For', '1.2.3.4')
          .set('Authorization', `Bearer ${token}`);
        expect(calls).toEqual(['mobile-a']);
      });
    });
  });
});
