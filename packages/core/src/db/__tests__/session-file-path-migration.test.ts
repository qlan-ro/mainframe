import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { initializeSchema } from '../schema.js';

describe('schema — session_file_path migration', () => {
  it('adds session_file_path column and is idempotent', () => {
    const db = new Database(':memory:');
    initializeSchema(db);
    initializeSchema(db);
    const cols = (db.pragma('table_info(chats)') as { name: string }[]).map((c) => c.name);
    expect(cols).toContain('session_file_path');
  });
});
