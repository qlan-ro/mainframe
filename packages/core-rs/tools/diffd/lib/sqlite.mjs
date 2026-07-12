// Dump the mutation-affected tables from a daemon's mainframe.db so the two
// data dirs can be diffed row-for-row after the replay. Uses better-sqlite3
// (resolved from the workspace) in read-only mode.
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);

const TABLES = ['projects', 'chats', 'tags', 'chat_tags', 'settings', 'devices'];

export function dumpTables(dataDir) {
  const Database = require('better-sqlite3');
  const db = new Database(path.join(dataDir, 'mainframe.db'), { readonly: true, fileMustExist: true });
  const out = {};
  try {
    for (const table of TABLES) {
      const exists = db
        .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?")
        .get(table);
      if (!exists) continue;
      const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
      const orderCol = cols.includes('id')
        ? 'id'
        : cols.includes('name')
          ? 'name'
          : cols.includes('device_id')
            ? 'device_id'
            : cols[0];
      out[table] = db.prepare(`SELECT * FROM ${table} ORDER BY ${orderCol}`).all();
    }
  } finally {
    db.close();
  }
  return out;
}
