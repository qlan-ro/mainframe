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

  it('bulkForChats returns a map of chatId -> tags', () => {
    const { tags, chatTags } = setup();
    chatTags.setForChat('c1', ['feature', 'ui'], tags);
    chatTags.setForChat('c2', ['bug'], tags);
    const map = chatTags.bulkForChats(['c1', 'c2', 'c3']);
    expect(map.get('c1')?.sort()).toEqual(['feature', 'ui']);
    expect(map.get('c2')).toEqual(['bug']);
    expect(map.has('c3')).toBe(false); // c3 has no tags
  });

  it('bulkForChats with empty input returns empty Map', () => {
    const { chatTags } = setup();
    expect(chatTags.bulkForChats([]).size).toBe(0);
  });

  it('cascades on chat deletion', () => {
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
    db.prepare(
      'INSERT INTO chats (id, adapter_id, project_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run('c1', 'claude', 'p1', 'active', now, now);
    const tags = new TagsRepository(db);
    const chatTags = new ChatTagsRepository(db);
    chatTags.setForChat('c1', ['feature'], tags);
    expect(chatTags.listForChat('c1')).toEqual(['feature']);
    db.prepare('DELETE FROM chats WHERE id = ?').run('c1');
    expect(chatTags.listForChat('c1')).toEqual([]);
  });

  it('setForChat rolls back when an invalid tag name throws', () => {
    const { tags, chatTags } = setup();
    chatTags.setForChat('c1', ['existing'], tags);
    // 'has-foo' triggers the reserved-prefix throw inside registry.upsert
    expect(() => chatTags.setForChat('c1', ['ok-tag', 'has-foo'], tags)).toThrow(/reserved/i);
    // Original associations preserved by transaction rollback.
    expect(chatTags.listForChat('c1')).toEqual(['existing']);
  });

  it('filterChatIds dedupes duplicate input tags', () => {
    const { tags, chatTags } = setup();
    chatTags.setForChat('c1', ['feature'], tags);
    // Duplicate input must not break HAVING COUNT
    expect(chatTags.filterChatIds(['feature', 'feature'])!.sort()).toEqual(['c1']);
  });
});
