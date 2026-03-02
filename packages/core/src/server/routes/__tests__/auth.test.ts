import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { authRoutes } from '../auth.js';

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
});
