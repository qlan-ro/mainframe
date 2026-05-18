import type Database from 'better-sqlite3';
import type { Tag, TagColor } from '@qlan-ro/mainframe-types';
import { validateTagName } from '../lib/validate-tag-name.js';
import { hashTagColor } from '../lib/tag-color.js';

export class TagsRepository {
  constructor(private db: Database.Database) {}

  private normalize(name: string): string {
    return name.trim().toLowerCase();
  }

  list(): Tag[] {
    const rows = this.db.prepare('SELECT name, color, created_at as createdAt FROM tags ORDER BY name').all() as Tag[];
    return rows;
  }

  get(name: string): Tag | null {
    const normalized = this.normalize(name);
    const row = this.db
      .prepare('SELECT name, color, created_at as createdAt FROM tags WHERE name = ?')
      .get(normalized) as Tag | undefined;
    return row ?? null;
  }

  /** Idempotent upsert. Returns the existing row if present, else creates with auto color. */
  upsert(rawName: string, color?: TagColor): Tag {
    const v = validateTagName(rawName);
    if (!v.ok) throw new Error(v.error);
    const existing = this.get(v.normalized);
    if (existing) return existing;
    const finalColor: TagColor = color ?? hashTagColor(v.normalized);
    const now = new Date().toISOString();
    this.db.prepare('INSERT INTO tags (name, color, created_at) VALUES (?, ?, ?)').run(v.normalized, finalColor, now);
    return { name: v.normalized, color: finalColor, createdAt: now };
  }

  setColor(name: string, color: TagColor): void {
    const normalized = this.normalize(name);
    const info = this.db.prepare('UPDATE tags SET color = ? WHERE name = ?').run(color, normalized);
    if (info.changes === 0) throw new Error(`Tag not found: ${normalized}`);
  }

  /** Atomic rename. If `to` already exists, merges associations and drops `from`. */
  rename(fromRaw: string, toRaw: string): void {
    const from = this.normalize(fromRaw);
    const v = validateTagName(toRaw);
    if (!v.ok) throw new Error(v.error);
    const to = v.normalized;
    if (from === to) return;
    const tx = this.db.transaction(() => {
      const target = this.get(to);
      if (target) {
        // Merge: redirect chat_tags then delete `from` registry row.
        this.db
          .prepare(
            'INSERT OR IGNORE INTO chat_tags (chat_id, tag, source, created_at) ' +
              'SELECT chat_id, ?, source, created_at FROM chat_tags WHERE tag = ?',
          )
          .run(to, from);
        this.db.prepare('DELETE FROM chat_tags WHERE tag = ?').run(from);
        this.db.prepare('DELETE FROM tags WHERE name = ?').run(from);
      } else {
        // Plain rename — ON UPDATE CASCADE moves chat_tags rows.
        this.db.prepare('UPDATE tags SET name = ? WHERE name = ?').run(to, from);
      }
    });
    tx();
  }

  remove(name: string): void {
    const normalized = this.normalize(name);
    const tx = this.db.transaction(() => {
      this.db.prepare('DELETE FROM chat_tags WHERE tag = ?').run(normalized);
      const info = this.db.prepare('DELETE FROM tags WHERE name = ?').run(normalized);
      if (info.changes === 0) throw new Error(`Tag not found: ${normalized}`);
    });
    tx();
  }
}
