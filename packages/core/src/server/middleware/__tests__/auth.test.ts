import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createAuthMiddleware } from '../auth.js';
import { generateToken } from '../../../auth/token.js';

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
