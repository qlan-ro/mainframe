//! `SegmentsRepository`: the public face of `chat_segments.rs` — layout reads,
//! the wire listing, and the single-transaction mutations the daemon calls.

use std::rc::Rc;

use mainframe_types::segment::{
    ChatSegment, HandoffRecord, SegmentLayout, SegmentRecord, SwitchCommit,
};
use rusqlite::Connection;

use crate::chat_native_sessions::{self as natives, NativePatch};
use crate::chat_segments::{
    RecordOutcome, ensure_seeded, list, record_native_id, start_context_reset,
};
use crate::{DbError, chat_handoffs};

pub use mainframe_types::segment::SegmentResultDelta;

pub struct SegmentsRepository {
    db: Rc<Connection>,
}

impl SegmentsRepository {
    pub fn new(db: Rc<Connection>) -> Self {
        Self { db }
    }

    /// Segments (ordinal order), the native rows they use, and their live
    /// handoffs. Seeds the initial rows, with a warning, if a chat has none.
    pub fn layout(&self, chat_id: &str) -> Result<SegmentLayout, DbError> {
        let mut segments = list(&self.db, chat_id)?;
        if segments.is_empty() {
            tracing::warn!(
                chat_id,
                "chat had no segment rows; seeding the initial segment"
            );
            ensure_seeded(&self.db, chat_id)?;
            segments = list(&self.db, chat_id)?;
        }
        Ok(SegmentLayout {
            segments,
            natives: natives::list_for_chat(&self.db, chat_id)?,
            handoffs: chat_handoffs::live_for_chat(&self.db, chat_id)?,
        })
    }

    /// `GET /api/chats/{id}/segments`.
    pub fn list_wire(&self, chat_id: &str) -> Result<Vec<ChatSegment>, DbError> {
        let layout = self.layout(chat_id)?;
        Ok(layout
            .segments
            .iter()
            .map(|s| to_wire(&layout, s))
            .collect())
    }

    pub fn record_native_id(
        &self,
        chat_id: &str,
        native_id: &str,
        path: Option<&str>,
    ) -> Result<RecordOutcome, DbError> {
        let tx = self.db.unchecked_transaction()?;
        let outcome = record_native_id(&tx, chat_id, native_id, path)?;
        tx.commit()?;
        Ok(outcome)
    }

    pub fn start_context_reset(&self, chat_id: &str) -> Result<(), DbError> {
        let tx = self.db.unchecked_transaction()?;
        start_context_reset(&tx, chat_id)?;
        tx.commit()?;
        Ok(())
    }

    /// Worktree moves relocate every owned transcript, not only the active one.
    pub fn set_session_file_path(&self, native_ref: &str, path: &str) -> Result<(), DbError> {
        let tx = self.db.unchecked_transaction()?;
        natives::apply_patch(
            &tx,
            native_ref,
            &NativePatch {
                session_file_path: Some(path.to_string()),
                ..Default::default()
            },
        )?;
        if let Some(native) = natives::get(&tx, native_ref)? {
            natives::write_mirror(&tx, &native.chat_id)?;
        }
        tx.commit()?;
        Ok(())
    }

    /// Marks one native row's transcript missing (or present) and re-mirrors.
    pub fn set_transcript_missing(&self, native_ref: &str, missing: bool) -> Result<(), DbError> {
        let tx = self.db.unchecked_transaction()?;
        natives::apply_patch(
            &tx,
            native_ref,
            &NativePatch {
                transcript_missing: Some(missing),
                ..Default::default()
            },
        )?;
        if let Some(native) = natives::get(&tx, native_ref)? {
            natives::write_mirror(&tx, &native.chat_id)?;
        }
        tx.commit()?;
        Ok(())
    }

    /// Adds one turn's deltas to the active segment.
    pub fn add_result(&self, chat_id: &str, delta: &SegmentResultDelta) -> Result<(), DbError> {
        self.db.execute(
            "UPDATE chat_segments SET turn_count = turn_count + 1, total_cost = total_cost + ?2,
               total_tokens_input = total_tokens_input + ?3,
               total_tokens_output = total_tokens_output + ?4,
               first_message_id = COALESCE(first_message_id, ?5),
               last_message_id = COALESCE(?6, last_message_id)
             WHERE chat_id = ?1 AND closed_at IS NULL",
            rusqlite::params![
                chat_id,
                delta.cost,
                delta.tokens_input,
                delta.tokens_output,
                delta.first_message_id,
                delta.last_message_id
            ],
        )?;
        Ok(())
    }

    /// Applies a planned switch in one transaction.
    pub fn commit_switch(&self, commit: &SwitchCommit) -> Result<SegmentLayout, DbError> {
        let tx = self.db.unchecked_transaction()?;
        crate::chat_segments_switch::apply(&tx, commit)?;
        tx.commit()?;
        self.layout(&commit.chat_id)
    }

    /// Moves the active segment onto a fresh, id-less native row of the same
    /// adapter: the returning session was too full to catch up, so the next
    /// spawn starts a new one. The old row keeps backing its closed segments.
    pub fn replace_active_native(&self, chat_id: &str) -> Result<SegmentLayout, DbError> {
        let tx = self.db.unchecked_transaction()?;
        let segment = crate::chat_segments::active(&tx, chat_id)?
            .ok_or_else(|| DbError::Message(format!("chat {chat_id} has no active segment")))?;
        let native = natives::active(&tx, chat_id)?
            .ok_or_else(|| DbError::Message(format!("chat {chat_id} has no active session")))?;
        let fresh = format!("ns_{}", nanoid::nanoid!());
        natives::insert_fresh(
            &tx,
            &fresh,
            chat_id,
            &native.adapter_id,
            native.model.as_deref(),
        )?;
        tx.execute(
            "UPDATE chat_segments SET native_session_ref = ? WHERE id = ?",
            rusqlite::params![fresh, segment.id],
        )?;
        natives::write_mirror(&tx, chat_id)?;
        tx.commit()?;
        self.layout(chat_id)
    }

    /// Whether any owned native row of the chat has a provider id — the point
    /// after which `PATCH /config` no longer changes the adapter.
    pub fn has_native_id(&self, chat_id: &str) -> Result<bool, DbError> {
        let count: i64 = self.db.query_row(
            "SELECT COUNT(*) FROM chat_native_sessions WHERE chat_id = ? \
             AND native_session_id IS NOT NULL AND borrowed_from_chat_id IS NULL",
            [chat_id],
            |row| row.get(0),
        )?;
        Ok(count > 0)
    }
}

fn to_wire(layout: &SegmentLayout, segment: &SegmentRecord) -> ChatSegment {
    let native = layout.native(&segment.native_session_ref);
    ChatSegment {
        id: segment.id.clone(),
        ordinal: segment.ordinal,
        kind: segment.kind,
        adapter_id: native.map(|n| n.adapter_id.clone()).unwrap_or_default(),
        model: native.and_then(|n| n.model.clone()),
        borrowed: native.is_some_and(|n| n.borrowed_from_chat_id.is_some()),
        native_session_id: native.and_then(|n| n.native_session_id.clone()),
        turn_count: segment.turn_count,
        total_cost: segment.total_cost,
        total_tokens_input: segment.total_tokens_input,
        total_tokens_output: segment.total_tokens_output,
        created_at: segment.created_at.clone(),
        closed_at: segment.closed_at.clone(),
        handoff: layout.handoff_for(&segment.id).map(HandoffRecord::summary),
    }
}
