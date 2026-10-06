//! Migration 31: provider segments. A chat owns an ordered list of segments,
//! each running on one provider-native session; `chats` keeps the active
//! segment's session columns as a mirror. Its own file because `migrations.rs`
//! is already past the 300-line limit.

use rusqlite::Connection;

use crate::DbError;

const SCHEMA_SQL: &str = r#"
CREATE TABLE IF NOT EXISTS chat_native_sessions (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  adapter_id TEXT NOT NULL,
  native_session_id TEXT,
  session_file_path TEXT,
  borrowed_from_chat_id TEXT,
  model TEXT,
  tuning TEXT,
  last_context_total_tokens INTEGER,
  last_context_max_tokens INTEGER,
  last_context_tokens_input INTEGER,
  transcript_missing INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_native_sessions_chat ON chat_native_sessions(chat_id);
CREATE INDEX IF NOT EXISTS idx_native_sessions_native_id ON chat_native_sessions(native_session_id);

CREATE TABLE IF NOT EXISTS chat_segments (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL,
  native_session_ref TEXT NOT NULL REFERENCES chat_native_sessions(id),
  kind TEXT NOT NULL CHECK (kind IN ('initial','provider_switch','context_reset')),
  start_marker TEXT,
  end_bound_message_id TEXT,
  end_bound_at TEXT,
  first_message_id TEXT,
  last_message_id TEXT,
  turn_count INTEGER NOT NULL DEFAULT 0,
  total_cost REAL NOT NULL DEFAULT 0,
  total_tokens_input INTEGER NOT NULL DEFAULT 0,
  total_tokens_output INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  closed_at TEXT,
  UNIQUE (chat_id, ordinal)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_segments_one_active
  ON chat_segments(chat_id) WHERE closed_at IS NULL;

CREATE TABLE IF NOT EXISTS chat_handoffs (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  target_segment_id TEXT NOT NULL REFERENCES chat_segments(id) ON DELETE CASCADE,
  strategy TEXT NOT NULL CHECK (strategy IN ('delta','full')),
  covered_from_ordinal INTEGER NOT NULL,
  covered_to_ordinal INTEGER NOT NULL,
  item_count INTEGER NOT NULL,
  omitted_count INTEGER NOT NULL,
  budget_bytes INTEGER NOT NULL,
  used_bytes INTEGER NOT NULL,
  fell_back_to_fresh INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('pending','delivered','superseded')),
  created_at TEXT NOT NULL,
  delivered_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_handoffs_one_live
  ON chat_handoffs(target_segment_id) WHERE status != 'superseded';
"#;

/// Copies a chat's session columns into its first native-session row. `?1` is
/// either one chat id or NULL (every chat), so the backfill and the per-insert
/// seeding share one statement. The `NOT EXISTS` guards make a re-run (legacy
/// DBs re-run the whole chain) a no-op.
pub(crate) const SEED_NATIVE_SQL: &str = "INSERT INTO chat_native_sessions (
    id, chat_id, adapter_id, native_session_id, session_file_path, borrowed_from_chat_id,
    model, tuning, last_context_total_tokens, last_context_max_tokens,
    last_context_tokens_input, transcript_missing, created_at, updated_at)
  SELECT 'ns_' || c.id, c.id, c.adapter_id, c.claude_session_id, c.session_file_path, NULL,
    c.model, NULL, c.last_context_total_tokens, c.last_context_max_tokens,
    c.last_context_tokens_input, COALESCE(c.transcript_missing, 0), c.created_at, c.updated_at
  FROM chats c
  WHERE (?1 IS NULL OR c.id = ?1)
    AND NOT EXISTS (SELECT 1 FROM chat_segments s WHERE s.chat_id = c.id)
    AND NOT EXISTS (SELECT 1 FROM chat_native_sessions n WHERE n.id = 'ns_' || c.id)";

/// The active `initial` segment at ordinal 0, counters copied from the chat.
pub(crate) const SEED_SEGMENT_SQL: &str = "INSERT INTO chat_segments (
    id, chat_id, ordinal, native_session_ref, kind, start_marker,
    turn_count, total_cost, total_tokens_input, total_tokens_output, created_at, closed_at)
  SELECT 'seg_' || c.id, c.id, 0, 'ns_' || c.id, 'initial', NULL,
    0, COALESCE(c.total_cost, 0), COALESCE(c.total_tokens_input, 0),
    COALESCE(c.total_tokens_output, 0), c.created_at, NULL
  FROM chats c
  WHERE (?1 IS NULL OR c.id = ?1)
    AND NOT EXISTS (SELECT 1 FROM chat_segments s WHERE s.chat_id = c.id)
    AND EXISTS (SELECT 1 FROM chat_native_sessions n WHERE n.id = 'ns_' || c.id)";

pub(super) fn up(db: &Connection) -> Result<(), DbError> {
    db.execute_batch(SCHEMA_SQL)?;
    seed(db, None)
}

/// Seeds the native-session row and the initial segment for one chat, or for
/// every chat that has none when `chat_id` is `None`.
pub(crate) fn seed(db: &Connection, chat_id: Option<&str>) -> Result<(), DbError> {
    db.execute(SEED_NATIVE_SQL, [chat_id])?;
    db.execute(SEED_SEGMENT_SQL, [chat_id])?;
    Ok(())
}
