//! `chat_handoffs`: the context block delivered to a native session when a
//! segment starts. Only its bookkeeping is stored; the block's text lives in
//! the target provider's transcript.

use std::rc::Rc;

use mainframe_runtime::time::now_iso8601;
use mainframe_types::segment::{HandoffRecord, HandoffStatus, HandoffStrategy};
use rusqlite::{Connection, OptionalExtension};

use crate::DbError;

const HANDOFF_FIELDS: &str = "id, chat_id, target_segment_id, strategy, covered_from_ordinal, \
  covered_to_ordinal, item_count, omitted_count, budget_bytes, used_bytes, fell_back_to_fresh, \
  status, created_at, delivered_at";

fn map_handoff(row: &rusqlite::Row<'_>) -> rusqlite::Result<HandoffRecord> {
    let to_u32 = |v: i64| v.max(0) as u32;
    let to_u64 = |v: i64| v.max(0) as u64;
    Ok(HandoffRecord {
        id: row.get("id")?,
        chat_id: row.get("chat_id")?,
        target_segment_id: row.get("target_segment_id")?,
        strategy: HandoffStrategy::from_db_str(&row.get::<_, String>("strategy")?),
        covered_from_ordinal: to_u32(row.get("covered_from_ordinal")?),
        covered_to_ordinal: to_u32(row.get("covered_to_ordinal")?),
        item_count: to_u32(row.get("item_count")?),
        omitted_count: to_u32(row.get("omitted_count")?),
        budget_bytes: to_u64(row.get("budget_bytes")?),
        used_bytes: to_u64(row.get("used_bytes")?),
        fell_back_to_fresh: row.get::<_, i64>("fell_back_to_fresh")? != 0,
        status: HandoffStatus::from_db_str(&row.get::<_, String>("status")?),
        created_at: row.get("created_at")?,
        delivered_at: row.get("delivered_at")?,
    })
}

pub(crate) fn live_for_chat(db: &Connection, chat_id: &str) -> Result<Vec<HandoffRecord>, DbError> {
    let sql = format!(
        "SELECT {HANDOFF_FIELDS} FROM chat_handoffs WHERE chat_id = ? AND status != 'superseded' \
         ORDER BY created_at"
    );
    let mut stmt = db.prepare(&sql)?;
    let rows = stmt.query_map([chat_id], map_handoff)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

/// Inserts `record` as it is, status and delivery time included (a fork's
/// copy of a delivered handoff).
pub(crate) fn insert(db: &Connection, record: &HandoffRecord) -> Result<(), DbError> {
    db.execute(
        "INSERT INTO chat_handoffs (id, chat_id, target_segment_id, strategy, \
         covered_from_ordinal, covered_to_ordinal, item_count, omitted_count, budget_bytes, \
         used_bytes, fell_back_to_fresh, status, created_at, delivered_at) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        rusqlite::params![
            record.id,
            record.chat_id,
            record.target_segment_id,
            record.strategy.as_db_str(),
            record.covered_from_ordinal,
            record.covered_to_ordinal,
            record.item_count,
            record.omitted_count,
            record.budget_bytes as i64,
            record.used_bytes as i64,
            i64::from(record.fell_back_to_fresh),
            record.status.as_db_str(),
            record.created_at,
            record.delivered_at,
        ],
    )?;
    Ok(())
}

pub struct HandoffsRepository {
    db: Rc<Connection>,
}

impl HandoffsRepository {
    pub fn new(db: Rc<Connection>) -> Self {
        Self { db }
    }

    /// The segment's non-superseded handoff, if any.
    pub fn live_for_segment(&self, segment_id: &str) -> Result<Option<HandoffRecord>, DbError> {
        let sql = format!(
            "SELECT {HANDOFF_FIELDS} FROM chat_handoffs WHERE target_segment_id = ? \
             AND status != 'superseded'"
        );
        Ok(self
            .db
            .query_row(&sql, [segment_id], map_handoff)
            .optional()?)
    }

    /// Supersedes the segment's older pending row, inserts `record` as
    /// pending, and stamps `segment.start_marker` (if unset) with the value the
    /// block's `segment="…"` attribute carries — all in one transaction.
    pub fn insert_pending(
        &self,
        record: &HandoffRecord,
        start_marker: &str,
    ) -> Result<(), DbError> {
        let tx = self.db.unchecked_transaction()?;
        tx.execute(
            "UPDATE chat_handoffs SET status = 'superseded' WHERE target_segment_id = ? \
             AND status = 'pending'",
            [&record.target_segment_id],
        )?;
        tx.execute(
            "INSERT INTO chat_handoffs (id, chat_id, target_segment_id, strategy, \
             covered_from_ordinal, covered_to_ordinal, item_count, omitted_count, budget_bytes, \
             used_bytes, fell_back_to_fresh, status, created_at) \
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)",
            rusqlite::params![
                record.id,
                record.chat_id,
                record.target_segment_id,
                record.strategy.as_db_str(),
                record.covered_from_ordinal,
                record.covered_to_ordinal,
                record.item_count,
                record.omitted_count,
                record.budget_bytes as i64,
                record.used_bytes as i64,
                i64::from(record.fell_back_to_fresh),
                record.created_at,
            ],
        )?;
        tx.execute(
            "UPDATE chat_segments SET start_marker = COALESCE(start_marker, ?) WHERE id = ?",
            rusqlite::params![start_marker, record.target_segment_id],
        )?;
        tx.commit()?;
        Ok(())
    }

    /// `delivered` stamps `delivered_at`; `superseded` frees the segment for a
    /// new handoff. Returns whether a row changed.
    pub fn set_status(&self, id: &str, status: HandoffStatus) -> Result<bool, DbError> {
        let delivered_at = (status == HandoffStatus::Delivered).then(now_iso8601);
        let changed = self.db.execute(
            "UPDATE chat_handoffs SET status = ?2, delivered_at = COALESCE(?3, delivered_at) \
             WHERE id = ?1 AND status != ?2",
            rusqlite::params![id, status.as_db_str(), delivered_at],
        )?;
        Ok(changed > 0)
    }
}
