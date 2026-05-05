import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { initializeSchema } from '../schema.js';
import { TagsRepository } from '../tags.js';
import { ChatTagsRepository } from '../chat-tags.js';

function setup() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  initializeSchema(db);
  const now = new Date().toISOString();
  db.prepare('INSERT INTO projects (id, name, path, created_at, last_opened_at) VALUES (?, ?, ?, ?, ?)').run(
    'p1',
    'p',
    '/tmp/p',
    now,
    now,
  );
  for (const id of ['c1', 'c2', 'c3']) {
    db.prepare(
      'INSERT INTO chats (id, adapter_id, project_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(id, 'claude', 'p1', 'active', now, now);
  }
  return { tags: new TagsRepository(db), chatTags: new ChatTagsRepository(db) };
}

describe('ChatTagsRepository', () => {
  it('listForChat returns empty initially', () => {
    expect(setup().chatTags.listForChat('c1')).toEqual([]);
  });

  it('setForChat replaces user tags atomically', () => {
    const { tags, chatTags } = setup();
    chatTags.setForChat('c1', ['feature', 'ui'], tags);
    expect(chatTags.listForChat('c1').sort()).toEqual(['feature', 'ui']);
    chatTags.setForChat('c1', ['bug'], tags);
    expect(chatTags.listForChat('c1')).toEqual(['bug']);
  });

  it('setForChat auto-creates missing tags', () => {
    const { tags, chatTags } = setup();
    chatTags.setForChat('c1', ['mobile'], tags);
    expect(tags.get('mobile')).not.toBeNull();
  });

  it('listInUse returns distinct tags currently associated', () => {
    const { tags, chatTags } = setup();
    chatTags.setForChat('c1', ['feature'], tags);
    chatTags.setForChat('c2', ['feature', 'bug'], tags);
    expect(chatTags.listInUse().sort()).toEqual(['bug', 'feature']);
  });

  it('listInUse with projectId filters', () => {
    const db = setup();
    db.chatTags.setForChat('c1', ['feature'], db.tags);
    expect(db.chatTags.listInUse('p1').sort()).toEqual(['feature']);
    expect(db.chatTags.listInUse('p-other')).toEqual([]);
  });

  it('filterChatIds AND-intersects user tags', () => {
    const { tags, chatTags } = setup();
    chatTags.setForChat('c1', ['feature', 'ui'], tags);
    chatTags.setForChat('c2', ['feature'], tags);
    chatTags.setForChat('c3', ['bug'], tags);
    expect(chatTags.filterChatIds(['feature', 'ui'])!.sort()).toEqual(['c1']);
    expect(chatTags.filterChatIds(['feature'])!.sort()).toEqual(['c1', 'c2']);
    expect(chatTags.filterChatIds([])).toBeNull();
  });
});
