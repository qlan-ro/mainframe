import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { initializeSchema } from '../schema.js';
import { TagsRepository } from '../tags.js';

function setup() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  initializeSchema(db);
  return new TagsRepository(db);
}

describe('TagsRepository', () => {
  it('list returns empty initially', () => {
    expect(setup().list()).toEqual([]);
  });

  it('upsert creates a tag with auto-color when missing', () => {
    const repo = setup();
    const tag = repo.upsert('feature');
    expect(tag.name).toBe('feature');
    expect(tag.color).toBeTruthy();
    expect(repo.list()).toHaveLength(1);
  });

  it('upsert is idempotent', () => {
    const repo = setup();
    const a = repo.upsert('feature');
    const b = repo.upsert('feature');
    expect(b.color).toBe(a.color);
    expect(repo.list()).toHaveLength(1);
  });

  it('rejects reserved prefix', () => {
    expect(() => setup().upsert('has-pr')).toThrow(/reserved/i);
  });

  it('rename moves the row and cascades chat_tags', () => {
    const repo = setup();
    repo.upsert('feat');
    repo.rename('feat', 'feature');
    const names = repo.list().map((t) => t.name);
    expect(names).toContain('feature');
    expect(names).not.toContain('feat');
  });

  it('rename to existing name merges (drops the source row)', () => {
    const repo = setup();
    repo.upsert('feat');
    repo.upsert('feature');
    repo.rename('feat', 'feature');
    expect(repo.list()).toHaveLength(1);
  });

  it('recolor updates color only', () => {
    const repo = setup();
    repo.upsert('feature');
    repo.setColor('feature', 'red');
    expect(repo.list()[0]!.color).toBe('red');
  });

  it('remove deletes the row', () => {
    const repo = setup();
    repo.upsert('feature');
    repo.remove('feature');
    expect(repo.list()).toHaveLength(0);
  });
});
