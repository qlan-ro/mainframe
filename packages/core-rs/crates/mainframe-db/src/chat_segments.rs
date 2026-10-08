//! `chat_segments`: the ordered provider segments of a chat. This repository
//! is the only writer of the `chats` session mirror (see
//! `chat_native_sessions.rs`); `ChatsRepository` routes its session-column
//! writes through the free functions here, in its own transaction.

use mainframe_runtime::time::now_iso8601;
use mainframe_types::segment::{SegmentKind, SegmentRecord};
use rusqlite::{Connection, OptionalExtension};

use crate::DbError;
use crate::chat_native_sessions::{self as natives, NativePatch};
use crate::migrations::v31_segments;

pub use crate::chat_segments_repo::{SegmentResultDelta, SegmentsRepository};

const SEGMENT_FIELDS: &str = "id, chat_id, ordinal, native_session_ref, kind, start_marker, \
  end_bound_message_id, end_bound_at, first_message_id, last_message_id, turn_count, \
  total_cost, total_tokens_input, total_tokens_output, created_at, closed_at";

fn map_segment(row: &rusqlite::Row<'_>) -> rusqlite::Result<SegmentRecord> {
    Ok(SegmentRecord {
        id: row.get("id")?,
        chat_id: row.get("chat_id")?,
        ordinal: row.get::<_, i64>("ordinal")?.max(0) as u32,
        native_session_ref: row.get("native_session_ref")?,
        kind: SegmentKind::from_db_str(&row.get::<_, String>("kind")?),
        start_marker: row.get("start_marker")?,
        end_bound_message_id: row.get("end_bound_message_id")?,
        end_bound_at: row.get("end_bound_at")?,
        first_message_id: row.get("first_message_id")?,
        last_message_id: row.get("last_message_id")?,
        turn_count: row.get::<_, i64>("turn_count")?.max(0) as u32,
        total_cost: row.get("total_cost")?,
        total_tokens_input: row.get("total_tokens_input")?,
        total_tokens_output: row.get("total_tokens_output")?,
        created_at: row.get("created_at")?,
        closed_at: row.get("closed_at")?,
    })
}

pub(crate) fn list(db: &Connection, chat_id: &str) -> Result<Vec<SegmentRecord>, DbError> {
    let sql =
        format!("SELECT {SEGMENT_FIELDS} FROM chat_segments WHERE chat_id = ? ORDER BY ordinal");
    let mut stmt = db.prepare(&sql)?;
    let rows = stmt.query_map([chat_id], map_segment)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

pub(crate) fn active(db: &Connection, chat_id: &str) -> Result<Option<SegmentRecord>, DbError> {
    let sql = format!(
        "SELECT {SEGMENT_FIELDS} FROM chat_segments WHERE chat_id = ? AND closed_at IS NULL"
    );
    Ok(db.query_row(&sql, [chat_id], map_segment).optional()?)
}

/// Seeds the initial rows for a chat that has none. Every insert path calls
/// this; a read that finds nothing calls it too, with a warning.
pub(crate) fn ensure_seeded(db: &Connection, chat_id: &str) -> Result<(), DbError> {
    v31_segments::seed(db, Some(chat_id))
}

/// How [`record_native_id`] treated a reported provider session id.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RecordOutcome {
    /// The active native row had no id; it now has this one.
    Set,
    /// The active native row already had this id.
    Unchanged,
    /// The provider replaced its session in-process (Claude `/clear`): a
    /// `context_reset` segment now runs on a new native row with this id.
    Reset { segment_id: String },
    /// The active segment had not run a turn yet, so a differing id was the
    /// adapter still resolving its own native id for this spawn (Codex
    /// reports a local placeholder immediately, then the real thread id once
    /// `thread/started` names it) rather than a genuine context reset: the
    /// same native row and segment were rebound to the new id in place.
    Rebound,
    /// The chat has no segment rows (it does not exist).
    NoChat,
}

/// The `record_native_id` rule: set when empty, ignore when equal, rebind in
/// place when different but the active segment never ran a turn (#772 live
/// QA: Codex's spawn-time placeholder resolving into the real thread id from
/// `thread/started` must not look like a context reset), and otherwise open a
/// `context_reset` segment — an id closed segments rely on is never
/// overwritten.
pub(crate) fn record_native_id(
    db: &Connection,
    chat_id: &str,
    native_id: &str,
    path: Option<&str>,
) -> Result<RecordOutcome, DbError> {
    ensure_seeded(db, chat_id)?;
    let Some(native) = natives::active(db, chat_id)? else {
        return Ok(RecordOutcome::NoChat);
    };
    let outcome = match native.native_session_id.as_deref() {
        None => {
            natives::set_native_id(db, &native.id, Some(native_id), path)?;
            RecordOutcome::Set
        }
        Some(existing) if existing == native_id => {
            if path.is_some() && path != native.session_file_path.as_deref() {
                natives::set_native_id(db, &native.id, Some(native_id), path)?;
            }
            RecordOutcome::Unchanged
        }
        Some(_) if active(db, chat_id)?.is_some_and(|s| s.turn_count == 0) => {
            natives::set_native_id(db, &native.id, Some(native_id), path)?;
            RecordOutcome::Rebound
        }
        Some(_) => {
            let segment =
                open_context_reset(db, chat_id, &native.adapter_id, native.model.as_deref())?;
            let fresh = natives::active(db, chat_id)?
                .ok_or_else(|| DbError::Message("context reset left no active segment".into()))?;
            natives::set_native_id(db, &fresh.id, Some(native_id), path)?;
            RecordOutcome::Reset {
                segment_id: segment.id,
            }
        }
    };
    natives::write_mirror(db, chat_id)?;
    Ok(outcome)
}

/// Plan "clear context", degraded recovery and `/clear`: the same adapter
/// continues on a new native session. A segment that never ran (no native id,
/// no turns) is reused instead, so repeated clears do not stack empty segments.
pub(crate) fn start_context_reset(db: &Connection, chat_id: &str) -> Result<(), DbError> {
    ensure_seeded(db, chat_id)?;
    let (Some(segment), Some(native)) = (active(db, chat_id)?, natives::active(db, chat_id)?)
    else {
        return Ok(());
    };
    if native.native_session_id.is_none() && segment.turn_count == 0 {
        natives::set_native_id(db, &native.id, None, None)?;
    } else {
        open_context_reset(db, chat_id, &native.adapter_id, native.model.as_deref())?;
    }
    natives::write_mirror(db, chat_id)
}

/// Rule 7's context loss: the active native session can't be resumed. Its id
/// is cleared in place unless a closed segment still reads it, in which case
/// a reset keeps that history intact.
pub(crate) fn clear_active_native_id(db: &Connection, chat_id: &str) -> Result<(), DbError> {
    ensure_seeded(db, chat_id)?;
    let Some(native) = natives::active(db, chat_id)? else {
        return Ok(());
    };
    if natives::backs_closed_segment(db, &native.id)? {
        open_context_reset(db, chat_id, &native.adapter_id, native.model.as_deref())?;
    } else {
        natives::set_native_id(db, &native.id, None, None)?;
    }
    natives::write_mirror(db, chat_id)
}

fn open_context_reset(
    db: &Connection,
    chat_id: &str,
    adapter_id: &str,
    model: Option<&str>,
) -> Result<SegmentRecord, DbError> {
    let now = now_iso8601();
    let native_ref = format!("ns_{}", nanoid::nanoid!());
    natives::insert_fresh(db, &native_ref, chat_id, adapter_id, model)?;
    db.execute(
        "UPDATE chat_segments SET closed_at = ? WHERE chat_id = ? AND closed_at IS NULL",
        rusqlite::params![now, chat_id],
    )?;
    insert_segment(
        db,
        chat_id,
        &format!("seg_{}", nanoid::nanoid!()),
        SegmentKind::ContextReset,
        &native_ref,
        &now,
    )
}

pub(crate) fn insert_segment(
    db: &Connection,
    chat_id: &str,
    id: &str,
    kind: SegmentKind,
    native_ref: &str,
    now: &str,
) -> Result<SegmentRecord, DbError> {
    let ordinal: i64 = db.query_row(
        "SELECT COALESCE(MAX(ordinal) + 1, 0) FROM chat_segments WHERE chat_id = ?",
        [chat_id],
        |row| row.get(0),
    )?;
    db.execute(
        "INSERT INTO chat_segments (id, chat_id, ordinal, native_session_ref, kind, created_at) \
         VALUES (?, ?, ?, ?, ?, ?)",
        rusqlite::params![id, chat_id, ordinal, native_ref, kind.as_db_str(), now],
    )?;
    let sql = format!("SELECT {SEGMENT_FIELDS} FROM chat_segments WHERE id = ?");
    Ok(db.query_row(&sql, [id], map_segment)?)
}

/// Routes a `chats` update's session columns to the active native row (then
/// the caller's own UPDATE writes the same values to the mirror).
pub(crate) fn absorb_chat_patch(
    db: &Connection,
    chat_id: &str,
    patch: &NativePatch,
) -> Result<(), DbError> {
    if patch.is_empty() {
        return Ok(());
    }
    ensure_seeded(db, chat_id)?;
    if let Some(native) = natives::active(db, chat_id)? {
        natives::apply_patch(db, &native.id, patch)?;
    }
    Ok(())
}
