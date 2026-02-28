import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createHttpServer } from '../server/http.js';

function createMockContext() {
  return {
    db: { projects: { get: vi.fn() }, chats: { get: vi.fn() }, settings: { get: vi.fn() } } as any,
    chats: { on: vi.fn() } as any,
    adapters: { get: vi.fn() } as any,
  };
}

describe('CORS policy', () => {
  it('does not reflect arbitrary origins', async () => {
    const ctx = createMockContext();
    const app = createHttpServer(ctx.db, ctx.chats, ctx.adapters);

    const res = await request(app).options('/health').set('Origin', 'https://evil.com');

    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    expect(res.status).toBe(204);
  });

  it('allows any localhost port origin', async () => {
    const ctx = createMockContext();
    const app = createHttpServer(ctx.db, ctx.chats, ctx.adapters);

    for (const origin of [
      'http://localhost:5173',
      'http://127.0.0.1:5173',
      'http://localhost:5174',
      'http://127.0.0.1:5174',
      'http://localhost:31415',
    ]) {
      const res = await request(app).get('/health').set('Origin', origin);
      expect(res.headers['access-control-allow-origin']).toBe(origin);
      expect(res.status).toBe(200);
    }
  });

  it('adds security headers', async () => {
    const ctx = createMockContext();
    const app = createHttpServer(ctx.db, ctx.chats, ctx.adapters);

    const res = await request(app).get('/health').set('Origin', 'http://localhost:5173');

    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
});
