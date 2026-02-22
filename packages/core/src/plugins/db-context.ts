import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { PluginDatabaseContext, PluginDatabaseStatement } from '@mainframe/types';

export function createPluginDatabaseContext(dbPath: string): PluginDatabaseContext {
  mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  return {
    runMigration(sql: string): void {
      db.exec(sql);
    },

    prepare<T = Record<string, unknown>>(sql: string): PluginDatabaseStatement<T> {
      const stmt = db.prepare(sql);
      return {
        run: (...params) => {
          stmt.run(...params);
        },
        get: (...params) => stmt.get(...params) as T | undefined,
        all: (...params) => stmt.all(...params) as T[],
      };
    },

    transaction<T>(fn: () => T): T {
      return db.transaction(fn)();
    },
  };
}
