use super::base::BASE_SCHEMA_SQL;
use crate::{
    DbError,
    migrate::{add_column_if_missing, has_column},
};
use mainframe_types::{chat::NO_PROJECT_ID, time::now_iso8601};
use rusqlite::Connection;

pub(super) fn v1(db: &Connection) -> Result<(), DbError> {
    db.execute_batch(BASE_SCHEMA_SQL)?;
    Ok(())
}

pub(super) fn v19(db: &Connection) -> Result<(), DbError> {
    if !has_column(db, "chats", "plan_mode")? {
        db.execute_batch("ALTER TABLE chats ADD COLUMN plan_mode INTEGER NOT NULL DEFAULT 0")?;
        db.execute_batch(
            "UPDATE chats SET plan_mode = 1, permission_mode = 'default' WHERE permission_mode = 'plan'",
        )?;
    }
    Ok(())
}

pub(super) fn v21(db: &Connection) -> Result<(), DbError> {
    let n: i64 = db.query_row(
        "SELECT COUNT(*) as n FROM chats WHERE adapter_id = 'claude-sdk'",
        [],
        |row| row.get(0),
    )?;
    if n > 0 {
        db.execute_batch("UPDATE chats SET adapter_id = 'claude' WHERE adapter_id = 'claude-sdk'")?;
    }
    Ok(())
}

pub(super) fn v24(db: &Connection) -> Result<(), DbError> {
    let plan_mode_settings: Vec<(String, String)> = {
        let mut stmt = db.prepare(
            "SELECT id, key FROM settings WHERE category='provider' AND key LIKE '%.defaultMode' AND value='plan'",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?;
        rows.collect::<Result<Vec<_>, _>>()?
    };
    for (id, key) in plan_mode_settings {
        let now = now_iso8601();
        let prefix = &key[..key.len() - ".defaultMode".len()];
        let plan_key = format!("{prefix}.defaultPlanMode");
        db.execute(
            "UPDATE settings SET value='default', updated_at=? WHERE id=?",
            rusqlite::params![now, id],
        )?;
        db.execute(
            "INSERT INTO settings (id, category, key, value, updated_at)
             VALUES (?, 'provider', ?, 'true', ?)
             ON CONFLICT(category, key) DO UPDATE SET value='true', updated_at=excluded.updated_at",
            rusqlite::params![format!("{id}-plan"), plan_key, now],
        )?;
    }
    Ok(())
}

pub(super) fn v25(db: &Connection) -> Result<(), DbError> {
    add_column_if_missing(
        db,
        "chats",
        "last_context_total_tokens",
        "ALTER TABLE chats ADD COLUMN last_context_total_tokens INTEGER",
    )?;
    add_column_if_missing(
        db,
        "chats",
        "last_context_max_tokens",
        "ALTER TABLE chats ADD COLUMN last_context_max_tokens INTEGER",
    )?;
    add_column_if_missing(
        db,
        "chats",
        "transcript_missing",
        "ALTER TABLE chats ADD COLUMN transcript_missing INTEGER DEFAULT 0",
    )
}

pub(super) fn v28(db: &Connection) -> Result<(), DbError> {
    add_column_if_missing(
        db,
        "chats",
        "parent_chat_id",
        "ALTER TABLE chats ADD COLUMN parent_chat_id TEXT",
    )?;
    db.execute_batch(
        "CREATE INDEX IF NOT EXISTS idx_chats_parent_chat_id ON chats(parent_chat_id)",
    )?;
    add_column_if_missing(
        db,
        "chats",
        "pending_fork",
        "ALTER TABLE chats ADD COLUMN pending_fork TEXT",
    )
}

pub(super) fn v29(db: &Connection) -> Result<(), DbError> {
    add_column_if_missing(
        db,
        "chats",
        "temporary",
        "ALTER TABLE chats ADD COLUMN temporary INTEGER NOT NULL DEFAULT 0",
    )?;
    add_column_if_missing(
        db,
        "chats",
        "vendor_session_ephemeral",
        "ALTER TABLE chats ADD COLUMN vendor_session_ephemeral INTEGER NOT NULL DEFAULT 0",
    )?;
    add_column_if_missing(
        db,
        "chats",
        "context_lost_at",
        "ALTER TABLE chats ADD COLUMN context_lost_at TEXT",
    )?;
    add_column_if_missing(
        db,
        "chats",
        "scratch_path",
        "ALTER TABLE chats ADD COLUMN scratch_path TEXT",
    )?;
    db.execute(
        "INSERT OR IGNORE INTO projects (id, name, path, created_at, last_opened_at) \
         VALUES (?, 'No project', 'mainframe:no-project', ?, ?)",
        rusqlite::params![NO_PROJECT_ID, now_iso8601(), now_iso8601()],
    )?;
    Ok(())
}

pub(super) fn v30(db: &Connection) -> Result<(), DbError> {
    Ok(db.execute_batch(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_chats_one_side_chat \
         ON chats(parent_chat_id) WHERE temporary = 1",
    )?)
}
