import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import Database from 'better-sqlite3';
import { initializeSchema } from '../../../db/schema.js';
import { TagsRepository } from '../../../db/tags.js';
import { ChatTagsRepository } from '../../../db/chat-tags.js';
import { ChatsRepository } from '../../../db/chats.js';
import { chatRoutes } from '../chats.js';
import type { RouteContext } from '../types.js';

function makeApp() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  initializeSchema(db);
  const tags = new TagsRepository(db);
  const chatTags = new ChatTagsRepository(db);
  const chats = new ChatsRepository(db, chatTags);

  const now = new Date().toISOString();
  db.prepare('INSERT INTO projects (id, name, path, created_at, last_opened_at) VALUES (?, ?, ?, ?, ?)').run(
    'p1',
    'p',
    '/tmp/p',
    now,
    now,
  );
  db.prepare('INSERT INTO projects (id, name, path, created_at, last_opened_at) VALUES (?, ?, ?, ?, ?)').run(
    'p2',
    'q',
    '/tmp/q',
    now,
    now,
  );

  // c1: tagged feature, has worktree
  // c2: tagged feature, no worktree
  // c3: tagged bug, has worktree
  // c4: untagged, has worktree (project p2)
  // c5: archived (must never appear)
  const seed = (id: string, projectId: string, worktree: string | null, status = 'active'): void => {
    db.prepare(
      `INSERT INTO chats (id, adapter_id, project_id, status, created_at, updated_at, worktree_path)
       VALUES (?, 'claude', ?, ?, ?, ?, ?)`,
    ).run(id, projectId, status, now, now, worktree);
  };
  seed('c1', 'p1', '/wt/c1');
  seed('c2', 'p1', null);
  seed('c3', 'p1', '/wt/c3');
  seed('c4', 'p2', '/wt/c4');
  seed('c5', 'p1', '/wt/c5', 'archived');
  chatTags.setForChat('c1', ['feature'], tags);
  chatTags.setForChat('c2', ['feature'], tags);
  chatTags.setForChat('c3', ['bug'], tags);

  const ctx = { chats: { listFiltered: chats.listFiltered.bind(chats) } } as unknown as RouteContext;
  const app = express();
  app.use(express.json());
  app.use(chatRoutes(ctx));
  return { app, db };
}

describe('GET /api/chats — filtered list', () => {
  it('no filters returns all non-archived chats', async () => {
    const { app } = makeApp();
    const res = await request(app).get('/api/chats');
    expect(res.status).toBe(200);
    const ids = res.body.data.map((c: { id: string }) => c.id).sort();
    expect(ids).toEqual(['c1', 'c2', 'c3', 'c4']);
  });

  it('filters by project', async () => {
    const { app } = makeApp();
    const res = await request(app).get('/api/chats?project=p2');
    expect(res.body.data.map((c: { id: string }) => c.id)).toEqual(['c4']);
  });

  it('filters by tags (single tag)', async () => {
    const { app } = makeApp();
    const res = await request(app).get('/api/chats?tags=feature');
    const ids = res.body.data.map((c: { id: string }) => c.id).sort();
    expect(ids).toEqual(['c1', 'c2']);
  });

  it('filters by synthetic has-worktree', async () => {
    const { app } = makeApp();
    const res = await request(app).get('/api/chats?synthetic=has-worktree');
    const ids = res.body.data.map((c: { id: string }) => c.id).sort();
    expect(ids).toEqual(['c1', 'c3', 'c4']);
  });

  it('AND-combines tags + synthetic + project', async () => {
    const { app } = makeApp();
    const res = await request(app).get('/api/chats?project=p1&tags=feature&synthetic=has-worktree');
    expect(res.body.data.map((c: { id: string }) => c.id)).toEqual(['c1']);
  });

  it('ignores has-pr in synthetic (handled client-side)', async () => {
    const { app } = makeApp();
    const res = await request(app).get('/api/chats?synthetic=has-pr');
    expect(res.body.data).toHaveLength(4);
  });

  it('Chat.tags is populated on filtered results', async () => {
    const { app } = makeApp();
    const res = await request(app).get('/api/chats?tags=feature');
    const c1 = res.body.data.find((c: { id: string }) => c.id === 'c1');
    expect(c1.tags).toEqual(['feature']);
  });
});
