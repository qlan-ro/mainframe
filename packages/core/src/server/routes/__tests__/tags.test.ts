import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import Database from 'better-sqlite3';
import { initializeSchema } from '../../../db/schema.js';
import { TagsRepository } from '../../../db/tags.js';
import { ChatTagsRepository } from '../../../db/chat-tags.js';
import { tagRoutes } from '../tags.js';
import type { RouteContext } from '../types.js';

function makeApp() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  initializeSchema(db);
  const tags = new TagsRepository(db);
  const chatTags = new ChatTagsRepository(db);
  // Minimal RouteContext stub — only fields tagRoutes uses are .db.tags / .db.chatTags
  const ctx = { db: { tags, chatTags } } as unknown as RouteContext;
  const app = express();
  app.use(express.json());
  app.use(tagRoutes(ctx));
  // Seed a chat for the chat-scoped routes
  const now = new Date().toISOString();
  db.prepare('INSERT INTO projects (id, name, path, created_at, last_opened_at) VALUES (?, ?, ?, ?, ?)').run(
    'p1',
    'p',
    '/tmp/p',
    now,
    now,
  );
  db.prepare(
    'INSERT INTO chats (id, adapter_id, project_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run('c1', 'claude', 'p1', 'active', now, now);
  return { app, db, tags, chatTags };
}

describe('tag routes', () => {
  it('GET /api/tags returns []', async () => {
    const { app } = makeApp();
    const res = await request(app).get('/api/tags');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it('POST /api/tags creates a tag', async () => {
    const { app } = makeApp();
    const res = await request(app).post('/api/tags').send({ name: 'feature' });
    expect(res.status).toBe(201);
    expect(res.body.data.name).toBe('feature');
    expect(res.body.data.color).toBeTruthy();
  });

  it('POST /api/tags rejects has- prefix with 400', async () => {
    const { app } = makeApp();
    const res = await request(app).post('/api/tags').send({ name: 'has-foo' });
    expect(res.status).toBe(400);
  });

  it('POST /api/tags rejects invalid color enum', async () => {
    const { app } = makeApp();
    const res = await request(app).post('/api/tags').send({ name: 'feature', color: 'not-a-color' });
    expect(res.status).toBe(400);
  });

  it('PATCH /api/tags/:name renames', async () => {
    const { app, tags } = makeApp();
    tags.upsert('feat');
    const res = await request(app).patch('/api/tags/feat').send({ rename: 'feature' });
    expect(res.status).toBe(200);
    expect(tags.get('feature')).not.toBeNull();
    expect(tags.get('feat')).toBeNull();
  });

  it('PATCH /api/tags/:name on missing tag returns 404', async () => {
    const { app } = makeApp();
    const res = await request(app).patch('/api/tags/nope').send({ color: 'red' });
    expect(res.status).toBe(404);
  });

  it('PATCH /api/tags/:name with empty body returns 400', async () => {
    const { app, tags } = makeApp();
    tags.upsert('feature');
    const res = await request(app).patch('/api/tags/feature').send({});
    expect(res.status).toBe(400);
  });

  it('DELETE /api/tags/:name removes', async () => {
    const { app, tags } = makeApp();
    tags.upsert('feature');
    const res = await request(app).delete('/api/tags/feature');
    expect(res.status).toBe(204);
    expect(tags.get('feature')).toBeNull();
  });

  // pins current behavior — see blockers: DELETE deviates from the rest of the
  // API by ending the response with no body at all, not the {success} envelope.
  it('DELETE /api/tags/:name returns 204 with an empty body, not the {success} envelope', async () => {
    const { app, tags } = makeApp();
    tags.upsert('feature');
    const res = await request(app).delete('/api/tags/feature');
    expect(res.status).toBe(204);
    expect(res.body).toEqual({});
    expect(res.text).toBe('');
  });

  it('DELETE /api/tags/:name on missing returns 404', async () => {
    const { app } = makeApp();
    const res = await request(app).delete('/api/tags/nope');
    expect(res.status).toBe(404);
  });

  it('GET /api/chats/:id/tags returns []', async () => {
    const { app } = makeApp();
    const res = await request(app).get('/api/chats/c1/tags');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it('PUT /api/chats/:id/tags applies tags', async () => {
    const { app } = makeApp();
    const res = await request(app)
      .put('/api/chats/c1/tags')
      .send({ tags: ['feature', 'ui'] });
    expect(res.status).toBe(200);
    expect(res.body.data.sort()).toEqual(['feature', 'ui']);
  });

  it('PATCH /api/tags/:name updates color only', async () => {
    const { app, tags } = makeApp();
    tags.upsert('feature');
    const res = await request(app).patch('/api/tags/feature').send({ color: 'red' });
    expect(res.status).toBe(200);
    expect(res.body.data.color).toBe('red');
    expect(tags.get('feature')?.color).toBe('red');
  });

  it('PATCH /api/tags/:name applies rename and color in one call', async () => {
    const { app, tags } = makeApp();
    tags.upsert('feat');
    const res = await request(app).patch('/api/tags/feat').send({ rename: 'feature', color: 'red' });
    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('feature');
    expect(res.body.data.color).toBe('red');
    expect(tags.get('feat')).toBeNull();
  });

  it('PUT /api/chats/:id/tags rejects reserved-prefix tag with 400', async () => {
    const { app } = makeApp();
    const res = await request(app)
      .put('/api/chats/c1/tags')
      .send({ tags: ['has-pr'] });
    expect(res.status).toBe(400);
  });

  it('PATCH /api/tags/:name rename cascades to chats already tagged with it', async () => {
    const { app } = makeApp();
    await request(app)
      .put('/api/chats/c1/tags')
      .send({ tags: ['feat'] });

    const res = await request(app).patch('/api/tags/feat').send({ rename: 'feature' });
    expect(res.status).toBe(200);

    const chatTags = await request(app).get('/api/chats/c1/tags');
    expect(chatTags.body.data).toEqual(['feature']);
  });
});
