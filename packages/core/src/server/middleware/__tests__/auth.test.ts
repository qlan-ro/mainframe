import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createAuthMiddleware } from '../auth.js';
import { generateToken } from '../../../auth/token.js';

describe('auth middleware', () => {
  const secret = 'test-secret-key-at-least-32-chars-long!!';

  function createApp(authSecret: string | null) {
    const app = express();
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
    app.set('trust proxy', true);
    const res = await request(app).get('/test').set('X-Forwarded-For', '192.168.1.100');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Unauthorized');
  });

  it('accepts non-localhost requests with valid token', async () => {
    const app = createApp(secret);
    app.set('trust proxy', true);
    const token = generateToken(secret, 'device-1');
    const res = await request(app)
      .get('/test')
      .set('X-Forwarded-For', '192.168.1.100')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
  });

  it('rejects non-localhost requests with invalid token', async () => {
    const app = createApp(secret);
    app.set('trust proxy', true);
    const res = await request(app)
      .get('/test')
      .set('X-Forwarded-For', '192.168.1.100')
      .set('Authorization', 'Bearer invalid-garbage');
    expect(res.status).toBe(401);
  });

  it('always allows /api/auth/ routes without token', async () => {
    const app = express();
    app.use(createAuthMiddleware(secret));
    app.get('/api/auth/pair', (_req, res) => res.json({ success: true }));
    app.set('trust proxy', true);
    const res = await request(app).get('/api/auth/pair').set('X-Forwarded-For', '192.168.1.100');
    expect(res.status).toBe(200);
  });

  it('always allows /health without token', async () => {
    const app = express();
    app.use(createAuthMiddleware(secret));
    app.get('/health', (_req, res) => res.json({ status: 'ok' }));
    app.set('trust proxy', true);
    const res = await request(app).get('/health').set('X-Forwarded-For', '192.168.1.100');
    expect(res.status).toBe(200);
  });
});
