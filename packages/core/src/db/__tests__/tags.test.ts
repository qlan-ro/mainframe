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
  it('list returns [] and get returns null on a fresh repo', () => {
    const repo = setup();
    expect(repo.list()).toEqual([]);
    expect(repo.get('nonexistent')).toBeNull();
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

  it.each([
    ['upsert rejects a reserved-prefix name', (repo: TagsRepository) => repo.upsert('has-pr'), /reserved/i],
    [
      'rename rejects a reserved-prefix target',
      (repo: TagsRepository) => {
        repo.upsert('feature');
        repo.rename('feature', 'has-pr');
      },
      /reserved/i,
    ],
    ['setColor throws when the tag is missing', (repo: TagsRepository) => repo.setColor('nope', 'red'), /not found/i],
    ['remove throws when the tag is missing', (repo: TagsRepository) => repo.remove('nope'), /not found/i],
  ])('%s', (_label, act, matcher) => {
    expect(() => act(setup())).toThrow(matcher);
  });

  // chat_tags cascading on rename is asserted separately below with real chat_tags rows.
  it('rename moves the row', () => {
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

  it('upsert normalizes whitespace and case', () => {
    const repo = setup();
    const a = repo.upsert('  Feature  ');
    expect(a.name).toBe('feature');
  });

  it('rename to self is a no-op (no throw, no list change)', () => {
    const repo = setup();
    repo.upsert('feature');
    expect(() => repo.rename('feature', 'feature')).not.toThrow();
    expect(repo.list()).toHaveLength(1);
  });

  it('upsert ignores color arg when tag already exists (color preserved)', () => {
    const repo = setup();
    const first = repo.upsert('feature'); // gets auto color
    const second = repo.upsert('feature', 'red');
    expect(second.color).toBe(first.color);
  });

  it('plain rename cascades chat_tags via ON UPDATE CASCADE', () => {
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
    const repo = new TagsRepository(db);
    repo.upsert('feat');
    db.prepare("INSERT INTO chat_tags (chat_id, tag, source, created_at) VALUES (?, ?, 'user', ?)").run(
      'c1',
      'feat',
      now,
    );
    repo.rename('feat', 'feature');
    const row = db.prepare('SELECT tag FROM chat_tags WHERE chat_id = ?').get('c1') as { tag: string };
    expect(row.tag).toBe('feature');
  });

  it('merge rename moves chat_tags rows under the target tag', () => {
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
    db.prepare(
      'INSERT INTO chats (id, adapter_id, project_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run('c2', 'claude', 'p1', 'active', now, now);
    const repo = new TagsRepository(db);
    repo.upsert('feat');
    repo.upsert('feature');
    db.prepare("INSERT INTO chat_tags (chat_id, tag, source, created_at) VALUES (?, ?, 'user', ?)").run(
      'c1',
      'feat',
      now,
    );
    db.prepare("INSERT INTO chat_tags (chat_id, tag, source, created_at) VALUES (?, ?, 'user', ?)").run(
      'c2',
      'feature',
      now,
    );
    repo.rename('feat', 'feature');
    const tags = db.prepare('SELECT tag FROM chat_tags ORDER BY chat_id').all() as { tag: string }[];
    expect(tags.map((r) => r.tag)).toEqual(['feature', 'feature']);
  });
});
