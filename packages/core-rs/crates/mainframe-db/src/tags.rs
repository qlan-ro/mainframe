use std::rc::Rc;

use mainframe_types::tags::{Tag, TagColor};
use mainframe_types::time::now_iso8601;
use rusqlite::Connection;

use crate::tag_color::hash_tag_color;
use crate::validate_tag_name::{ValidateResult, validate_tag_name};
use crate::{
    DbError,
    sql_types::{FromRow, SqlEnum, query_all, query_opt},
};

pub struct TagsRepository {
    db: Rc<Connection>,
}

impl TagsRepository {
    pub fn new(db: Rc<Connection>) -> Self {
        Self { db }
    }

    fn normalize(&self, name: &str) -> String {
        name.trim().to_lowercase()
    }

    pub fn list(&self) -> Result<Vec<Tag>, DbError> {
        query_all(
            &self.db,
            "SELECT name, color, created_at FROM tags ORDER BY name",
            [],
        )
    }

    pub fn get(&self, name: &str) -> Result<Option<Tag>, DbError> {
        query_opt(
            &self.db,
            "SELECT name, color, created_at FROM tags WHERE name = ?",
            [self.normalize(name)],
        )
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

impl FromRow for Tag {
    type Error = DbError;

    /// A stored colour outside the palette is logged and read as the name's
    /// hashed palette colour (what `upsert` would have assigned), the same
    /// warn-and-default policy as the chat and todo rows, so one bad row does
    /// not fail every tag listing.
    fn from_row(row: &rusqlite::Row<'_>) -> Result<Self, DbError> {
        let name: String = row.get("name")?;
        let raw: String = row.get("color")?;
        let color = SqlEnum::<TagColor>::parse(raw.clone()).unwrap_or_else(|error| {
            tracing::warn!(
                tag = %name, raw, %error,
                "tags: invalid stored colour; using the name's palette colour"
            );
            hash_tag_color(&name)
        });
        Ok(Self {
            name,
            color,
            created_at: row.get("created_at")?,
        })
    }
}
