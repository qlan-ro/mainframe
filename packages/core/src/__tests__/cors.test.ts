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

  it('allows known localhost origins', async () => {
    const ctx = createMockContext();
    const app = createHttpServer(ctx.db, ctx.chats, ctx.adapters);

    const res = await request(app).get('/health').set('Origin', 'http://localhost:5173');

    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(res.status).toBe(200);
  });

  it('adds security headers', async () => {
    const ctx = createMockContext();
    const app = createHttpServer(ctx.db, ctx.chats, ctx.adapters);

    const res = await request(app).get('/health').set('Origin', 'http://localhost:5173');

    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
});
