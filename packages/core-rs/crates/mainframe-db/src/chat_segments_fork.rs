//! Segment rows of a fork: copying a multi-segment parent's segments into a
//! new fork (`copy_from_parent`), and turning an unsent fork's pinned native
//! row into a borrowed view of the parent when it switches provider before
//! its first send (`borrow_pinned`). Both run inside the caller's transaction.

use std::collections::HashMap;

use mainframe_types::segment::{
    BorrowConversion, ForkPlan, ForkSegmentRole, HandoffStatus, NativeSessionRecord, SegmentKind,
    SegmentRecord,
};
use mainframe_types::time::now_iso8601;
use rusqlite::Connection;

use crate::chat_native_sessions as natives;
use crate::chat_segments::{insert_segment, list};
use crate::{DbError, chat_handoffs};

/// The parent rows a copy reads, and the fork rows it has made so far.
struct ForkCopy<'a> {
    db: &'a Connection,
    fork_id: &'a str,
    parent_id: &'a str,
    model: Option<&'a str>,
    now: String,
    segments: Vec<SegmentRecord>,
    natives: Vec<NativeSessionRecord>,
    /// Parent native row id -> the fork's row for it (pinned or borrowed).
    rows: HashMap<String, String>,
}

/// Copies the parent's segments into `fork_id` as `plan` says: pinned
/// segments run on one fresh native row of the fork's own (the pending fork
/// resumes into it), every other one on a borrowed row bounded where its
/// segment ended. Copies keep kind, ordinal, start marker, turn count and
/// delivered handoff summaries; cost and token counters start at zero.
pub(crate) fn copy_from_parent(
    db: &Connection,
    fork_id: &str,
    parent_id: &str,
    model: Option<&str>,
    plan: &ForkPlan,
) -> Result<(), DbError> {
    let mut copy = ForkCopy {
        db,
        fork_id,
        parent_id,
        model,
        now: now_iso8601(),
        segments: list(db, parent_id)?,
        natives: natives::list_for_chat(db, parent_id)?,
        rows: HashMap::new(),
    };
    let last = plan.segments.len().saturating_sub(1);
    for (index, planned) in plan.segments.iter().enumerate() {
        let active = index == last && !plan.pending_active;
        copy.segment(&planned.source_segment_id, &planned.role, active)?;
    }
    if plan.pending_active {
        copy.pending_segment()?;
    }
    natives::write_mirror(db, fork_id)
}

impl ForkCopy<'_> {
    fn segment(
        &mut self,
        source_id: &str,
        role: &ForkSegmentRole,
        active: bool,
    ) -> Result<(), DbError> {
        let Some(source) = self.segments.iter().find(|s| s.id == source_id).cloned() else {
            return Err(DbError::Message(format!(
                "parent segment {source_id} not found"
            )));
        };
        let native_ref = self.native_row(&source.native_session_ref, role)?;
        let (end_message_id, end_at) = match role {
            ForkSegmentRole::Pinned => (None, None),
            ForkSegmentRole::Borrowed {
                end_message_id,
                end_at,
            } => (end_message_id.clone(), end_at.clone()),
        };
        let copied = SegmentRecord {
            id: format!("seg_{}", nanoid::nanoid!()),
            chat_id: self.fork_id.to_string(),
            native_session_ref: native_ref,
            end_bound_message_id: end_message_id,
            end_bound_at: end_at,
            total_cost: 0.0,
            total_tokens_input: 0,
            total_tokens_output: 0,
            closed_at: (!active).then(|| source.closed_at.clone().unwrap_or(self.now.clone())),
            ..source.clone()
        };
        insert_copied(self.db, &copied)?;
        copy_delivered_handoff(self.db, self.parent_id, &source.id, &copied)
    }

    /// The fork's row for a parent native row, created on first use.
    fn native_row(&mut self, parent_ref: &str, role: &ForkSegmentRole) -> Result<String, DbError> {
        let key = match role {
            ForkSegmentRole::Pinned => "pinned".to_string(),
            ForkSegmentRole::Borrowed { .. } => parent_ref.to_string(),
        };
        if let Some(existing) = self.rows.get(&key) {
            return Ok(existing.clone());
        }
        let parent = self
            .natives
            .iter()
            .find(|n| n.id == parent_ref)
            .ok_or_else(|| DbError::Message(format!("parent native row {parent_ref} not found")))?;
        let id = format!("ns_{}", nanoid::nanoid!());
        match role {
            ForkSegmentRole::Pinned => {
                natives::insert_fresh(self.db, &id, self.fork_id, &parent.adapter_id, self.model)?
            }
            ForkSegmentRole::Borrowed { .. } => {
                // A row the parent itself borrows stays owned by its owner.
                let owner = parent
                    .borrowed_from_chat_id
                    .as_deref()
                    .unwrap_or(self.parent_id);
                natives::insert_borrowed(self.db, &id, self.fork_id, owner, parent)?
            }
        }
        self.rows.insert(key, id.clone());
        Ok(id)
    }

    /// A lazy cross-provider fork: a new pending segment for the parent's
    /// active adapter on a fresh native row.
    fn pending_segment(&self) -> Result<(), DbError> {
        let adapter = natives::active(self.db, self.parent_id)?
            .map(|n| n.adapter_id)
            .ok_or_else(|| DbError::Message("parent has no active segment".into()))?;
        let native_ref = format!("ns_{}", nanoid::nanoid!());
        natives::insert_fresh(self.db, &native_ref, self.fork_id, &adapter, self.model)?;
        let id = format!("seg_{}", nanoid::nanoid!());
        insert_segment(
            self.db,
            self.fork_id,
            &id,
            SegmentKind::ProviderSwitch,
            &native_ref,
            &self.now,
        )?;
        Ok(())
    }
}

fn insert_copied(db: &Connection, s: &SegmentRecord) -> Result<(), DbError> {
    db.execute(
        "INSERT INTO chat_segments (id, chat_id, ordinal, native_session_ref, kind, start_marker, \
         end_bound_message_id, end_bound_at, first_message_id, last_message_id, turn_count, \
         total_cost, total_tokens_input, total_tokens_output, created_at, closed_at) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, ?, ?)",
        rusqlite::params![
            s.id,
            s.chat_id,
            s.ordinal,
            s.native_session_ref,
            s.kind.as_db_str(),
            s.start_marker,
            s.end_bound_message_id,
            s.end_bound_at,
            s.first_message_id,
            s.last_message_id,
            s.turn_count,
            s.created_at,
            s.closed_at,
        ],
    )?;
    Ok(())
}

/// A delivered handoff travels with its segment, so the fork's divider keeps
/// its counts and the first send never re-delivers it.
fn copy_delivered_handoff(
    db: &Connection,
    parent_id: &str,
    source_segment_id: &str,
    copied: &SegmentRecord,
) -> Result<(), DbError> {
    let delivered = chat_handoffs::live_for_chat(db, parent_id)?
        .into_iter()
        .find(|h| h.target_segment_id == source_segment_id && h.status == HandoffStatus::Delivered);
    let Some(mut handoff) = delivered else {
        return Ok(());
    };
    handoff.id = format!("ho_{}", nanoid::nanoid!());
    handoff.chat_id = copied.chat_id.clone();
    handoff.target_segment_id = copied.id.clone();
    chat_handoffs::insert(db, &handoff)
}

/// The unsent fork's pinned native row becomes a read-only view of the
/// parent's source session, each of its segments takes the bound where the
/// fork's pin ended, and the pending fork is retired. The row keeps its id,
/// so segments need no rewiring. The caller's commit rewrites the mirror.
pub(crate) fn borrow_pinned(db: &Connection, c: &BorrowConversion) -> Result<(), DbError> {
    db.execute(
        "UPDATE chat_native_sessions SET borrowed_from_chat_id = ?2, native_session_id = ?3, \
         session_file_path = ?4, transcript_missing = 0, updated_at = ?5 \
         WHERE id = ?1 AND chat_id = ?6",
        rusqlite::params![
            c.native_ref,
            c.owner_chat_id,
            c.native_session_id,
            c.session_file_path,
            now_iso8601(),
            c.chat_id,
        ],
    )?;
    for bound in &c.bounds {
        db.execute(
            "UPDATE chat_segments SET end_bound_message_id = ?2, end_bound_at = ?3 \
             WHERE id = ?1 AND chat_id = ?4 AND native_session_ref = ?5",
            rusqlite::params![
                bound.segment_id,
                bound.end_message_id,
                bound.end_at,
                c.chat_id,
                c.native_ref,
            ],
        )?;
    }
    db.execute(
        "UPDATE chats SET pending_fork = NULL WHERE id = ?",
        [&c.chat_id],
    )?;
    Ok(())
}
