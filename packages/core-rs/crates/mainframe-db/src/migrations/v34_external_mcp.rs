use rusqlite::Connection;

use crate::DbError;

pub(super) fn up(db: &Connection) -> Result<(), DbError> {
    db.execute_batch(
        "CREATE TABLE external_mcp_clients (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            token_hash BLOB NOT NULL UNIQUE,
            project_ids TEXT NOT NULL,
            access TEXT NOT NULL CHECK(access IN ('read', 'control')),
            max_permission_mode TEXT NOT NULL,
            created_at TEXT NOT NULL,
            last_used_at TEXT
        );",
    )?;
    Ok(())
}
