//! Ported from `packages/core/src/db/chat-tags.ts`.

use std::collections::HashMap;
use std::rc::Rc;

use mainframe_runtime::time::now_iso8601;
use rusqlite::Connection;

use crate::DbError;
use crate::tags::TagsRepository;

#[derive(Clone)]
pub struct ChatTagsRepository {
    db: Rc<Connection>,
}

/// De-duplicate while preserving first-seen order (mirrors `[...new Set(x)]`).
fn dedup(items: &[String]) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    for item in items {
        if seen.insert(item.clone()) {
            out.push(item.clone());
        }
    }
    out
}

impl ChatTagsRepository {
    pub fn new(db: Rc<Connection>) -> Self {
        Self { db }
    }

    pub fn list_for_chat(&self, chat_id: &str) -> Result<Vec<String>, DbError> {
        let mut stmt = self.db.prepare(
            "SELECT tag FROM chat_tags WHERE chat_id = ? AND source = 'user' ORDER BY tag",
        )?;
        let rows = stmt.query_map([chat_id], |row| row.get::<_, String>(0))?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }

    /// Map of chatId -> user tags. Used to populate Chat.tags on list queries.
    pub fn bulk_for_chats(
        &self,
        chat_ids: &[String],
    ) -> Result<HashMap<String, Vec<String>>, DbError> {
        let mut out: HashMap<String, Vec<String>> = HashMap::new();
        if chat_ids.is_empty() {
            return Ok(out);
        }
        let placeholders = vec!["?"; chat_ids.len()].join(",");
        let sql = format!(
            "SELECT chat_id as chatId, tag FROM chat_tags \
             WHERE source = 'user' AND chat_id IN ({placeholders}) \
             ORDER BY chat_id, tag"
        );
        let mut stmt = self.db.prepare(&sql)?;
        let params = rusqlite::params_from_iter(chat_ids.iter());
        let rows = stmt.query_map(params, |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?;
        for row in rows {
            let (chat_id, tag) = row?;
            out.entry(chat_id).or_default().push(tag);
        }
        Ok(out)
    }

    /// Replace the user tag set for a chat atomically. Auto-creates any missing tags.
    pub fn set_for_chat(
        &self,
        chat_id: &str,
        tags: &[String],
        registry: &TagsRepository,
    ) -> Result<(), DbError> {
        let unique = dedup(tags);
        let tx = self.db.unchecked_transaction()?;
        tx.execute(
            "DELETE FROM chat_tags WHERE chat_id = ? AND source = 'user'",
            [chat_id],
        )?;
        let now = now_iso8601();
        for raw in &unique {
            let tag = registry.upsert(raw, None)?; // throws on invalid input
            tx.execute(
                "INSERT OR IGNORE INTO chat_tags (chat_id, tag, source, created_at) VALUES (?, ?, 'user', ?)",
                rusqlite::params![chat_id, tag.name, now],
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    /// Distinct user tags currently in use, optionally restricted to a project.
    /// Drives the filter bar's tag chip list.
    pub fn list_in_use(&self, project_id: Option<&str>) -> Result<Vec<String>, DbError> {
        if let Some(project_id) = project_id {
            let mut stmt = self.db.prepare(
                "SELECT DISTINCT ct.tag FROM chat_tags ct \
                 JOIN chats c ON c.id = ct.chat_id \
                 WHERE ct.source = 'user' AND c.project_id = ? AND c.status != 'archived' \
                 ORDER BY ct.tag",
            )?;
            let rows = stmt.query_map([project_id], |row| row.get::<_, String>(0))?;
            return Ok(rows.collect::<Result<Vec<_>, _>>()?);
        }
        let mut stmt = self.db.prepare(
            "SELECT DISTINCT ct.tag FROM chat_tags ct \
             JOIN chats c ON c.id = ct.chat_id \
             WHERE ct.source = 'user' AND c.status != 'archived' \
             ORDER BY ct.tag",
        )?;
        let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }

    /// Returns chat ids that have ALL of the supplied tags.
    /// Returns None when `tags` is empty (caller treats None as "no tag filter").
    pub fn filter_chat_ids(&self, tags: &[String]) -> Result<Option<Vec<String>>, DbError> {
        let unique = dedup(tags);
        if unique.is_empty() {
            return Ok(None);
        }
        let placeholders = vec!["?"; unique.len()].join(",");
        let sql = format!(
            "SELECT chat_id FROM chat_tags \
             WHERE source = 'user' AND tag IN ({placeholders}) \
             GROUP BY chat_id \
             HAVING COUNT(DISTINCT tag) = ?"
        );
        let mut stmt = self.db.prepare(&sql)?;
        let mut params: Vec<rusqlite::types::Value> = unique
            .iter()
            .map(|t| rusqlite::types::Value::Text(t.clone()))
            .collect();
        params.push(rusqlite::types::Value::Integer(unique.len() as i64));
        let rows = stmt.query_map(rusqlite::params_from_iter(params), |row| {
            row.get::<_, String>(0)
        })?;
        Ok(Some(rows.collect::<Result<Vec<_>, _>>()?))
    }
}

// PORT STATUS: src/db/chat-tags.ts (96 lines)
// confidence: high
// notes: `[...new Set(tags)]` becomes dedup() (order-preserving). Map<string,
// string[]> → HashMap (key order unobservable). filterChatIds returns
// Option<Vec> (null → None for empty input). set_for_chat uses
// unchecked_transaction(); registry.upsert() runs on the same shared connection,
// so its INSERTs join the transaction and an invalid tag's error rolls the whole
// set back (the "rolls back when invalid" test). now_iso8601() for created_at.
// Derives Clone so DatabaseManager can both keep it as a field and hand it to
// ChatsRepository. Tests in tests/chat_tags.rs.
// todos: 0
