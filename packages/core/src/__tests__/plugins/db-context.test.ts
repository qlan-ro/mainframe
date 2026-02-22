import { describe, it, expect, beforeEach } from 'vitest';
import { createPluginDatabaseContext } from '../../plugins/db-context.js';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { mkdtempSync } from 'node:fs';

describe('PluginDatabaseContext', () => {
  let dbPath: string;

  beforeEach(() => {
    const dir = mkdtempSync(path.join(tmpdir(), 'plugin-db-test-'));
    dbPath = path.join(dir, 'data.db');
  });

  it('runs migrations and allows typed queries', () => {
    const ctx = createPluginDatabaseContext(dbPath);
    ctx.runMigration('CREATE TABLE items (id TEXT PRIMARY KEY, value TEXT)');
    ctx.prepare('INSERT INTO items VALUES (?, ?)').run('k1', 'v1');
    const row = ctx.prepare<{ id: string; value: string }>('SELECT * FROM items WHERE id = ?').get('k1');
    expect(row).toEqual({ id: 'k1', value: 'v1' });
  });

  it('supports transactions', () => {
    const ctx = createPluginDatabaseContext(dbPath);
    ctx.runMigration('CREATE TABLE t (n INTEGER)');
    ctx.transaction(() => {
      ctx.prepare('INSERT INTO t VALUES (?)').run(1);
      ctx.prepare('INSERT INTO t VALUES (?)').run(2);
    });
    const rows = ctx.prepare<{ n: number }>('SELECT * FROM t').all();
    expect(rows).toHaveLength(2);
  });

  it('all() returns empty array when no rows', () => {
    const ctx = createPluginDatabaseContext(dbPath);
    ctx.runMigration('CREATE TABLE empty (id TEXT)');
    const rows = ctx.prepare('SELECT * FROM empty').all();
    expect(rows).toEqual([]);
  });
});
