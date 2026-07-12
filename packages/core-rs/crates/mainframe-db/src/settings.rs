//! Ported from `packages/core/src/db/settings.ts`.

use std::collections::HashMap;
use std::rc::Rc;

use mainframe_runtime::time::now_iso8601;
use rusqlite::{Connection, OptionalExtension};

use crate::DbError;

pub struct SettingsRepository {
    db: Rc<Connection>,
}

impl SettingsRepository {
    pub fn new(db: Rc<Connection>) -> Self {
        Self { db }
    }

    pub fn get(&self, category: &str, key: &str) -> Result<Option<String>, DbError> {
        Ok(self
            .db
            .query_row(
                "SELECT value FROM settings WHERE category = ? AND key = ?",
                rusqlite::params![category, key],
                |row| row.get(0),
            )
            .optional()?)
    }

    pub fn get_by_category(&self, category: &str) -> Result<HashMap<String, String>, DbError> {
        let mut stmt = self
            .db
            .prepare("SELECT key, value FROM settings WHERE category = ?")?;
        let rows = stmt.query_map([category], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?;
        let mut out = HashMap::new();
        for row in rows {
            let (key, value) = row?;
            out.insert(key, value);
        }
        Ok(out)
    }

    pub fn set(&self, category: &str, key: &str, value: &str) -> Result<(), DbError> {
        self.db.execute(
            "INSERT INTO settings (id, category, key, value, updated_at)
             VALUES (?, ?, ?, ?, ?)
             ON CONFLICT(category, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
            rusqlite::params![nanoid::nanoid!(), category, key, value, now_iso8601()],
        )?;
        Ok(())
    }

    pub fn delete(&self, category: &str, key: &str) -> Result<(), DbError> {
        self.db.execute(
            "DELETE FROM settings WHERE category = ? AND key = ?",
            rusqlite::params![category, key],
        )?;
        Ok(())
    }
}

// PORT STATUS: src/db/settings.ts (31 lines)
// confidence: high
// notes: getByCategory returns a HashMap (the TS Object.fromEntries record); the
// query has no ORDER BY, so key order is unobservable and a HashMap is faithful.
// upsert uses nanoid + now_iso8601 like the TS. No dedicated test file in the TS
// __tests__ suite; behavior is exercised via migration 24's settings backfill in
// tests/migrations.rs.
// todos: 0
