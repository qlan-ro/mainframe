import type Database from 'better-sqlite3';
import { nanoid } from 'nanoid';

export class SettingsRepository {
  constructor(private db: Database.Database) {}

  get(category: string, key: string): string | null {
    const stmt = this.db.prepare('SELECT value FROM settings WHERE category = ? AND key = ?');
    const row = stmt.get(category, key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  getByCategory(category: string): Record<string, string> {
    const stmt = this.db.prepare('SELECT key, value FROM settings WHERE category = ?');
    const rows = stmt.all(category) as { key: string; value: string }[];
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  }

  set(category: string, key: string, value: string): void {
    const stmt = this.db.prepare(`
      INSERT INTO settings (id, category, key, value, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(category, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `);
    stmt.run(nanoid(), category, key, value, new Date().toISOString());
  }

  delete(category: string, key: string): void {
    this.db.prepare('DELETE FROM settings WHERE category = ? AND key = ?').run(category, key);
  }
}
