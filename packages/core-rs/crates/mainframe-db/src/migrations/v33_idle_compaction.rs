use crate::DbError;
use rusqlite::Connection;

pub(super) fn up(db: &Connection) -> Result<(), DbError> {
    db.execute_batch("CREATE TABLE IF NOT EXISTS idle_compaction_runs (
        chat_id TEXT PRIMARY KEY REFERENCES chats(id) ON DELETE CASCADE,
        generation TEXT NOT NULL,
        outcome TEXT NOT NULL DEFAULT 'running' CHECK(outcome IN ('running','success','failed')),
        completed_ms INTEGER,
        claim TEXT,
        command_uuid TEXT,
        session_generation TEXT
    );
    CREATE TABLE IF NOT EXISTS idle_compaction_commands (
        request_id TEXT PRIMARY KEY, chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE, payload TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS idle_compaction_queue (
        uuid TEXT PRIMARY KEY, chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE, payload TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS idle_compaction_provenance (
        chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
        request_id TEXT PRIMARY KEY,
        metadata TEXT NOT NULL, created_at TEXT NOT NULL
    );")?;
    Ok(())
}
