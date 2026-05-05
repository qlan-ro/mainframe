import type Database from 'better-sqlite3';
import type { TagsRepository } from './tags.js';

export class ChatTagsRepository {
  constructor(private db: Database.Database) {}

  listForChat(chatId: string): string[] {
    const rows = this.db
      .prepare("SELECT tag FROM chat_tags WHERE chat_id = ? AND source = 'user' ORDER BY tag")
      .all(chatId) as { tag: string }[];
    return rows.map((r) => r.tag);
  }

  /** Map of chatId -> user tags. Used to populate Chat.tags on list queries. */
  bulkForChats(chatIds: string[]): Map<string, string[]> {
    const out = new Map<string, string[]>();
    if (chatIds.length === 0) return out;
    const placeholders = chatIds.map(() => '?').join(',');
    const rows = this.db
      .prepare(
        `SELECT chat_id as chatId, tag FROM chat_tags
         WHERE source = 'user' AND chat_id IN (${placeholders})
         ORDER BY chat_id, tag`,
      )
      .all(...chatIds) as { chatId: string; tag: string }[];
    for (const r of rows) {
      const list = out.get(r.chatId);
      if (list) list.push(r.tag);
      else out.set(r.chatId, [r.tag]);
    }
    return out;
  }

  /** Replace the user tag set for a chat atomically. Auto-creates any missing tags. */
  setForChat(chatId: string, tags: string[], registry: TagsRepository): void {
    const tx = this.db.transaction(() => {
      this.db.prepare("DELETE FROM chat_tags WHERE chat_id = ? AND source = 'user'").run(chatId);
      const insert = this.db.prepare(
        "INSERT OR IGNORE INTO chat_tags (chat_id, tag, source, created_at) VALUES (?, ?, 'user', ?)",
      );
      const now = new Date().toISOString();
      for (const raw of tags) {
        const tag = registry.upsert(raw); // throws on invalid input
        insert.run(chatId, tag.name, now);
      }
    });
    tx();
  }

  /**
   * Distinct user tags currently in use, optionally restricted to a project.
   * Drives the filter bar's tag chip list.
   */
  listInUse(projectId?: string): string[] {
    if (projectId) {
      const rows = this.db
        .prepare(
          `SELECT DISTINCT ct.tag FROM chat_tags ct
           JOIN chats c ON c.id = ct.chat_id
           WHERE ct.source = 'user' AND c.project_id = ? AND c.status != 'archived'
           ORDER BY ct.tag`,
        )
        .all(projectId) as { tag: string }[];
      return rows.map((r) => r.tag);
    }
    const rows = this.db
      .prepare(
        `SELECT DISTINCT ct.tag FROM chat_tags ct
         JOIN chats c ON c.id = ct.chat_id
         WHERE ct.source = 'user' AND c.status != 'archived'
         ORDER BY ct.tag`,
      )
      .all() as { tag: string }[];
    return rows.map((r) => r.tag);
  }

  /**
   * Returns chat ids that have ALL of the supplied tags.
   * Returns null when `tags` is empty (caller treats null as "no tag filter").
   */
  filterChatIds(tags: string[]): string[] | null {
    if (tags.length === 0) return null;
    const placeholders = tags.map(() => '?').join(',');
    const rows = this.db
      .prepare(
        `SELECT chat_id FROM chat_tags
         WHERE source = 'user' AND tag IN (${placeholders})
         GROUP BY chat_id
         HAVING COUNT(DISTINCT tag) = ?`,
      )
      .all(...tags, tags.length) as { chat_id: string }[];
    return rows.map((r) => r.chat_id);
  }
}
