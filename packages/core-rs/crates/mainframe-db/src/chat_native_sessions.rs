//! `chat_native_sessions` rows and the `chats` mirror.
//!
//! The mirror invariant: `chats.adapter_id`, `claude_session_id`,
//! `session_file_path`, the three `last_context_*` columns and
//! `transcript_missing` always describe the active segment's native session.
//! Every write to those columns goes through this module, inside the caller's
//! transaction, so the two never disagree.

use mainframe_types::chat::SessionTuning;
use mainframe_types::segment::NativeSessionRecord;
use mainframe_types::time::now_iso8601;
use rusqlite::{Connection, OptionalExtension};

use crate::DbError;

pub(crate) const NATIVE_FIELDS: &str = "id, chat_id, adapter_id, native_session_id, \
  session_file_path, borrowed_from_chat_id, model, tuning, last_context_total_tokens, \
  last_context_max_tokens, last_context_tokens_input, transcript_missing, created_at, updated_at";

pub(crate) fn map_native(row: &rusqlite::Row<'_>) -> rusqlite::Result<NativeSessionRecord> {
    let tuning: Option<String> = row.get("tuning")?;
    Ok(NativeSessionRecord {
        id: row.get("id")?,
        chat_id: row.get("chat_id")?,
        adapter_id: row.get("adapter_id")?,
        native_session_id: row.get("native_session_id")?,
        session_file_path: row.get("session_file_path")?,
        borrowed_from_chat_id: row.get("borrowed_from_chat_id")?,
        model: row.get("model")?,
        tuning: tuning.and_then(|raw| parse_tuning(&raw)),
        last_context_total_tokens: row
            .get::<_, Option<i64>>("last_context_total_tokens")?
            .map(|v| v.max(0) as u64),
        last_context_max_tokens: row
            .get::<_, Option<i64>>("last_context_max_tokens")?
            .map(|v| v.max(0) as u64),
        last_context_tokens_input: row.get("last_context_tokens_input")?,
        transcript_missing: row.get::<_, i64>("transcript_missing")? != 0,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

fn parse_tuning(raw: &str) -> Option<SessionTuning> {
    match serde_json::from_str(raw) {
        Ok(tuning) => Some(tuning),
        Err(err) => {
            // A corrupt snapshot only loses the restore-on-return convenience.
            tracing::warn!(%err, "ignoring unreadable native-session tuning snapshot");
            None
        }
    }
}

pub(crate) fn list_for_chat(
    db: &Connection,
    chat_id: &str,
) -> Result<Vec<NativeSessionRecord>, DbError> {
    let sql = format!(
        "SELECT {NATIVE_FIELDS} FROM chat_native_sessions WHERE chat_id = ? ORDER BY created_at, id"
    );
    let mut stmt = db.prepare(&sql)?;
    let rows = stmt.query_map([chat_id], map_native)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

pub(crate) fn get(db: &Connection, id: &str) -> Result<Option<NativeSessionRecord>, DbError> {
    let sql = format!("SELECT {NATIVE_FIELDS} FROM chat_native_sessions WHERE id = ?");
    Ok(db.query_row(&sql, [id], map_native).optional()?)
}

/// The active segment's native row.
pub(crate) fn active(
    db: &Connection,
    chat_id: &str,
) -> Result<Option<NativeSessionRecord>, DbError> {
    let sql = format!(
        "SELECT {NATIVE_FIELDS} FROM chat_native_sessions WHERE id = \
         (SELECT native_session_ref FROM chat_segments WHERE chat_id = ? AND closed_at IS NULL)"
    );
    Ok(db.query_row(&sql, [chat_id], map_native).optional()?)
}

/// A fresh, id-less native row for `adapter_id`.
pub(crate) fn insert_fresh(
    db: &Connection,
    id: &str,
    chat_id: &str,
    adapter_id: &str,
    model: Option<&str>,
) -> Result<(), DbError> {
    let now = now_iso8601();
    db.execute(
        "INSERT INTO chat_native_sessions (id, chat_id, adapter_id, model, transcript_missing, \
         created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?)",
        rusqlite::params![id, chat_id, adapter_id, model, now, now],
    )?;
    Ok(())
}

/// A read-only row in `chat_id` for another chat's native session (`source`),
/// owned by `owner_chat_id`: never resumed, relocated or written.
pub(crate) fn insert_borrowed(
    db: &Connection,
    id: &str,
    chat_id: &str,
    owner_chat_id: &str,
    source: &NativeSessionRecord,
) -> Result<(), DbError> {
    let now = now_iso8601();
    db.execute(
        "INSERT INTO chat_native_sessions (id, chat_id, adapter_id, native_session_id, \
         session_file_path, borrowed_from_chat_id, model, transcript_missing, created_at, \
         updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        rusqlite::params![
            id,
            chat_id,
            source.adapter_id,
            source.native_session_id,
            source.session_file_path,
            owner_chat_id,
            source.model,
            i64::from(source.transcript_missing),
            now,
            now,
        ],
    )?;
    Ok(())
}

/// Whether any closed segment still runs on `native_ref` — its native id is
/// then pinned: overwriting it would point that history at the wrong transcript.
pub(crate) fn backs_closed_segment(db: &Connection, native_ref: &str) -> Result<bool, DbError> {
    let count: i64 = db.query_row(
        "SELECT COUNT(*) FROM chat_segments WHERE native_session_ref = ? AND closed_at IS NOT NULL",
        [native_ref],
        |row| row.get(0),
    )?;
    Ok(count > 0)
}

/// Columns a `chats` update may carry that belong to the active native row.
#[derive(Debug, Clone, Default, PartialEq)]
pub(crate) struct NativePatch {
    pub adapter_id: Option<String>,
    pub model: Option<String>,
    pub session_file_path: Option<String>,
    pub last_context_tokens_input: Option<i64>,
    pub last_context_total_tokens: Option<u64>,
    pub last_context_max_tokens: Option<u64>,
    pub transcript_missing: Option<bool>,
}

impl NativePatch {
    pub(crate) fn is_empty(&self) -> bool {
        *self == Self::default()
    }
}

/// Applies `patch` to `native_ref` (each `None` field is left as-is).
pub(crate) fn apply_patch(
    db: &Connection,
    native_ref: &str,
    patch: &NativePatch,
) -> Result<(), DbError> {
    if patch.is_empty() {
        return Ok(());
    }
    db.execute(
        "UPDATE chat_native_sessions SET
           adapter_id = COALESCE(?2, adapter_id),
           model = COALESCE(?3, model),
           session_file_path = COALESCE(?4, session_file_path),
           last_context_tokens_input = COALESCE(?5, last_context_tokens_input),
           last_context_total_tokens = COALESCE(?6, last_context_total_tokens),
           last_context_max_tokens = COALESCE(?7, last_context_max_tokens),
           transcript_missing = COALESCE(?8, transcript_missing),
           updated_at = ?9
         WHERE id = ?1",
        rusqlite::params![
            native_ref,
            patch.adapter_id,
            patch.model,
            patch.session_file_path,
            patch.last_context_tokens_input,
            patch.last_context_total_tokens.map(|v| v as i64),
            patch.last_context_max_tokens.map(|v| v as i64),
            patch.transcript_missing.map(i64::from),
            now_iso8601(),
        ],
    )?;
    Ok(())
}

/// Sets (or clears, with `None`) the provider-native id and its file path.
pub(crate) fn set_native_id(
    db: &Connection,
    native_ref: &str,
    native_id: Option<&str>,
    path: Option<&str>,
) -> Result<(), DbError> {
    db.execute(
        "UPDATE chat_native_sessions SET native_session_id = ?2, session_file_path = ?3, \
         transcript_missing = 0, updated_at = ?4 WHERE id = ?1",
        rusqlite::params![native_ref, native_id, path, now_iso8601()],
    )?;
    Ok(())
}

/// The switch-away snapshot: the model and tuning restored when returning.
pub(crate) fn save_snapshot(
    db: &Connection,
    native_ref: &str,
    model: Option<&str>,
    tuning: Option<&SessionTuning>,
) -> Result<(), DbError> {
    let tuning_json = tuning.map(serde_json::to_string).transpose()?;
    db.execute(
        "UPDATE chat_native_sessions SET model = ?2, tuning = ?3, updated_at = ?4 WHERE id = ?1",
        rusqlite::params![native_ref, model, tuning_json, now_iso8601()],
    )?;
    Ok(())
}

/// Rewrites the `chats` mirror columns from the active segment's native row.
pub(crate) fn write_mirror(db: &Connection, chat_id: &str) -> Result<(), DbError> {
    db.execute(
        "UPDATE chats SET
           adapter_id = n.adapter_id,
           claude_session_id = n.native_session_id,
           session_file_path = n.session_file_path,
           last_context_total_tokens = n.last_context_total_tokens,
           last_context_max_tokens = n.last_context_max_tokens,
           last_context_tokens_input = COALESCE(n.last_context_tokens_input, 0),
           transcript_missing = n.transcript_missing
         FROM (SELECT ns.* FROM chat_segments s
               JOIN chat_native_sessions ns ON ns.id = s.native_session_ref
               WHERE s.chat_id = ?1 AND s.closed_at IS NULL) AS n
         WHERE chats.id = ?1",
        [chat_id],
    )?;
    Ok(())
}
