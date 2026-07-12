//! Ported from `packages/core/src/db/tags.ts`.

use std::rc::Rc;

use mainframe_runtime::time::now_iso8601;
use mainframe_types::tags::{Tag, TagColor};
use rusqlite::Connection;

use crate::DbError;
use crate::tag_color::hash_tag_color;
use crate::validate_tag_name::{ValidateResult, validate_tag_name};

pub struct TagsRepository {
    db: Rc<Connection>,
}

fn parse_tag_color(s: String) -> Result<TagColor, DbError> {
    Ok(serde_json::from_value(serde_json::Value::String(s))?)
}

impl TagsRepository {
    pub fn new(db: Rc<Connection>) -> Self {
        Self { db }
    }

    fn normalize(&self, name: &str) -> String {
        name.trim().to_lowercase()
    }

    pub fn list(&self) -> Result<Vec<Tag>, DbError> {
        let mut stmt = self
            .db
            .prepare("SELECT name, color, created_at as createdAt FROM tags ORDER BY name")?;
        let mut rows = stmt.query([])?;
        let mut out = Vec::new();
        while let Some(row) = rows.next()? {
            out.push(Tag {
                name: row.get("name")?,
                color: parse_tag_color(row.get("color")?)?,
                created_at: row.get("createdAt")?,
            });
        }
        Ok(out)
    }

    pub fn get(&self, name: &str) -> Result<Option<Tag>, DbError> {
        let normalized = self.normalize(name);
        let mut stmt = self
            .db
            .prepare("SELECT name, color, created_at as createdAt FROM tags WHERE name = ?")?;
        let mut rows = stmt.query([normalized])?;
        match rows.next()? {
            Some(row) => Ok(Some(Tag {
                name: row.get("name")?,
                color: parse_tag_color(row.get("color")?)?,
                created_at: row.get("createdAt")?,
            })),
            None => Ok(None),
        }
    }

    /// Idempotent upsert. Returns the existing row if present, else creates with auto color.
    pub fn upsert(&self, raw_name: &str, color: Option<TagColor>) -> Result<Tag, DbError> {
        let normalized = match validate_tag_name(raw_name) {
            ValidateResult::Ok { normalized } => normalized,
            ValidateResult::Err { error } => return Err(DbError::Message(error)),
        };
        if let Some(existing) = self.get(&normalized)? {
            return Ok(existing);
        }
        let final_color = color.unwrap_or_else(|| hash_tag_color(&normalized));
        let now = now_iso8601();
        self.db.execute(
            "INSERT INTO tags (name, color, created_at) VALUES (?, ?, ?)",
            rusqlite::params![normalized, crate::enum_to_db_string(&final_color)?, now],
        )?;
        Ok(Tag {
            name: normalized,
            color: final_color,
            created_at: now,
        })
    }

    pub fn set_color(&self, name: &str, color: TagColor) -> Result<(), DbError> {
        let normalized = self.normalize(name);
        let changes = self.db.execute(
            "UPDATE tags SET color = ? WHERE name = ?",
            rusqlite::params![crate::enum_to_db_string(&color)?, normalized],
        )?;
        if changes == 0 {
            return Err(DbError::Message(format!("Tag not found: {normalized}")));
        }
        Ok(())
    }

    /// Atomic rename. If `to` already exists, merges associations and drops `from`.
    pub fn rename(&self, from_raw: &str, to_raw: &str) -> Result<(), DbError> {
        let from = self.normalize(from_raw);
        let to = match validate_tag_name(to_raw) {
            ValidateResult::Ok { normalized } => normalized,
            ValidateResult::Err { error } => return Err(DbError::Message(error)),
        };
        if from == to {
            return Ok(());
        }
        let tx = self.db.unchecked_transaction()?;
        if self.get(&to)?.is_some() {
            // Merge: redirect chat_tags then delete `from` registry row.
            tx.execute(
                "INSERT OR IGNORE INTO chat_tags (chat_id, tag, source, created_at) \
                 SELECT chat_id, ?, source, created_at FROM chat_tags WHERE tag = ?",
                rusqlite::params![to, from],
            )?;
            tx.execute("DELETE FROM chat_tags WHERE tag = ?", [&from])?;
            tx.execute("DELETE FROM tags WHERE name = ?", [&from])?;
        } else {
            // Plain rename — ON UPDATE CASCADE moves chat_tags rows.
            tx.execute(
                "UPDATE tags SET name = ? WHERE name = ?",
                rusqlite::params![to, from],
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    pub fn remove(&self, name: &str) -> Result<(), DbError> {
        let normalized = self.normalize(name);
        let tx = self.db.unchecked_transaction()?;
        tx.execute("DELETE FROM chat_tags WHERE tag = ?", [&normalized])?;
        let changes = tx.execute("DELETE FROM tags WHERE name = ?", [&normalized])?;
        if changes == 0 {
            return Err(DbError::Message(format!("Tag not found: {normalized}")));
        }
        tx.commit()?;
        Ok(())
    }
}

// PORT STATUS: src/db/tags.ts (80 lines)
// confidence: high
// notes: validate_tag_name / hash_tag_color are imported from the sibling
// modules relocated into this crate (§2.15). `throw new Error(v.error)` /
// "Tag not found: X" become DbError::Message with byte-identical strings (the
// ported tests assert /reserved/i and /not found/i). rename()/remove() use
// unchecked_transaction() (Rc<Connection>); on the "Tag not found" early return
// the tx drops → ROLLBACK, matching the TS transaction that never commits. Tag
// color is stored as its serde string and parsed back via serde. Tests in
// tests/tags.rs.
// todos: 0
