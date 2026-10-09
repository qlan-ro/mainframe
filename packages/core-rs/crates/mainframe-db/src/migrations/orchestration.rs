//! Migration 32: agent orchestration (spec
//! `docs/specs/2026-10-06-mcp-orchestration-server.md`). Version 31 is reserved
//! for the in-place provider-switch migration landing in parallel; the runner
//! applies any version above the stamped one, so the gap is safe as long as 31
//! merges before a build stamped 32 ships.
//!
//! `created_by_chat_id` records which chat's agent started a chat (launch and
//! delegate alike). `delegated_tasks` is the one row per delegated child.
//! Children are ordinary non-temporary chats: the side-chat invariant
//! (`idx_chats_one_side_chat ... WHERE temporary = 1`) would otherwise reject
//! a second child and let a child pose as a side chat.

use rusqlite::Connection;

use super::add_column_if_missing;
use crate::DbError;

pub(super) const VERSION: i64 = 32;

const DELEGATED_TASKS_SQL: &str = r#"
  CREATE INDEX IF NOT EXISTS idx_chats_created_by ON chats(created_by_chat_id);

  CREATE TABLE IF NOT EXISTS delegated_tasks (
    id                TEXT PRIMARY KEY,
    parent_chat_id    TEXT NOT NULL,
    child_chat_id     TEXT NOT NULL UNIQUE,
    client_request_id TEXT,
    title             TEXT,
    role              TEXT NOT NULL DEFAULT 'general',
    status            TEXT NOT NULL,
    depth             INTEGER NOT NULL,
    summary           TEXT,
    error             TEXT,
    cancel_reason     TEXT,
    delivery          TEXT NOT NULL DEFAULT 'pending',
    created_at        TEXT NOT NULL,
    updated_at        TEXT NOT NULL,
    completed_at      TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_delegated_tasks_parent ON delegated_tasks(parent_chat_id);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_delegated_tasks_request
    ON delegated_tasks(parent_chat_id, client_request_id) WHERE client_request_id IS NOT NULL;
"#;

pub(super) fn up(db: &Connection) -> Result<(), DbError> {
    add_column_if_missing(
        db,
        "chats",
        "created_by_chat_id",
        "ALTER TABLE chats ADD COLUMN created_by_chat_id TEXT",
    )?;
    db.execute_batch(DELEGATED_TASKS_SQL)?;
    Ok(())
}
