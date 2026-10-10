//! Per-chat `RevisionLog` registry and the `FacadeHub` methods that record into
//! it and reset its epoch, split out of `hub.rs` to keep that file under the
//! 300-line cap. Eviction is always safe: a dropped log is exactly an unknown
//! epoch to its chat's next resume, and `RevisionLog::plan` already treats that
//! as a full replay — nothing on the wire distinguishes "evicted" from "the
//! daemon restarted".

use mainframe_types::sync::LockExt as _;
use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, Mutex};

use mainframe_acp::EncodedItem;
use mainframe_acp::encoder::delta::EncodedDelta;
use mainframe_acp::revision_log::{RecordOutcome, RevisionLog};
use mainframe_types::acp::extensions::RevisionCursor;

use super::FacadeHub;

/// Chats a daemon keeps a revision log for, bounded so memory stays flat
/// regardless of how many chats accumulate over a daemon's lifetime —
/// logs exist only for chats an opted-in client has resumed at least once.
const MAX_LOGGED_CHATS: usize = 32;

#[derive(Default)]
struct RegistryState {
    logs: HashMap<String, Arc<Mutex<RevisionLog>>>,
    /// Touch order, oldest first — a plain `Vec`-backed `VecDeque` rather
    /// than a real LRU structure; `MAX_LOGGED_CHATS` is small enough that a
    /// linear `retain` per touch is not worth a dependency.
    order: VecDeque<String>,
}

/// Per-chat `RevisionLog`s, least-recently-touched evicted first once the
/// registry is full.
#[derive(Default)]
pub(crate) struct RevisionRegistry {
    state: Mutex<RegistryState>,
}

impl RevisionRegistry {
    /// The chat's log, creating one under a fresh epoch if it has none
    /// yet. `FacadeHub::begin_resume` calls this for an opted-in
    /// connection, after installing its `AwaitingSeed` claim.
    fn get_or_create(&self, chat_id: &str) -> Arc<Mutex<RevisionLog>> {
        let mut state = self.locked();
        self.touch(&mut state, chat_id);
        state
            .logs
            .entry(chat_id.to_string())
            .or_insert_with(|| Arc::new(Mutex::new(RevisionLog::new(nanoid::nanoid!()))))
            .clone()
    }

    /// The chat's log if one already exists — never creates one. A chat
    /// nobody has ever opted into revision cursors for has none, and
    /// recording into it would be pure bookkeeping with no reader.
    fn get(&self, chat_id: &str) -> Option<Arc<Mutex<RevisionLog>>> {
        let mut state = self.locked();
        let log = state.logs.get(chat_id).cloned();
        if log.is_some() {
            self.touch(&mut state, chat_id);
        }
        log
    }

    /// Rotate `chat_id` onto a fresh, unseeded log under a new epoch.
    /// `TranscriptCleared`, `Resync`, a finished compaction, and a vanished
    /// tool call (which `RevisionLog::record` cannot express) all invalidate
    /// every cursor issued against the old epoch outright. A no-op for a
    /// chat with no log: nobody has resumed with revision cursors for it,
    /// so there is nothing to invalidate.
    fn reset_epoch(&self, chat_id: &str) {
        let mut state = self.locked();
        if state.logs.contains_key(chat_id) {
            state.logs.insert(
                chat_id.to_string(),
                Arc::new(Mutex::new(RevisionLog::new(nanoid::nanoid!()))),
            );
        }
    }

    /// `ChatEnded`: forget the log entirely.
    fn drop_chat(&self, chat_id: &str) {
        let mut state = self.locked();
        state.logs.remove(chat_id);
        state.order.retain(|id| id != chat_id);
    }

    fn locked(&self) -> std::sync::MutexGuard<'_, RegistryState> {
        self.state.lock_recover()
    }

    fn touch(&self, state: &mut RegistryState, chat_id: &str) {
        state.order.retain(|id| id != chat_id);
        state.order.push_back(chat_id.to_string());
        while state.order.len() > MAX_LOGGED_CHATS {
            if let Some(evicted) = state.order.pop_front() {
                state.logs.remove(&evicted);
            }
        }
    }
}

impl FacadeHub {
    /// The chat's log, creating one for an opted-in connection — called
    /// from `begin_resume`, after its `AwaitingSeed` claim is installed
    /// (the race argument lives there). `None` for a connection that did
    /// not opt in: no log is created, and `dispatch_resume` gets byte-
    /// identical legacy behavior.
    pub(super) fn revision_log_for_resume(
        &self,
        opted_in: bool,
        chat_id: &str,
    ) -> Option<Arc<Mutex<RevisionLog>>> {
        opted_in.then(|| self.revisions.get_or_create(chat_id))
    }

    /// Record one display revision into the chat's log, if it has one —
    /// whether or not a connection is attached (revision accounting must
    /// not depend on connection presence). Returns the new boundary for a
    /// recorded, non-empty change; `None` when there is no log, nothing
    /// changed, or a vanished tool call forced an epoch reset instead.
    ///
    /// `delta`-shaped (`RevisionLog::record_delta`) rather than a flat item
    /// list — `full` is the lazy fresh-attach fallback `record_delta` forces
    /// only when this log is unseeded and `delta` is incremental.
    pub(super) fn record_display_delta(
        &self,
        chat_id: &str,
        delta: &EncodedDelta,
        full: impl FnOnce() -> Vec<Vec<EncodedItem>>,
    ) -> Option<RevisionCursor> {
        let log = self.revisions.get(chat_id)?;
        let mut locked = log.lock_recover();
        match locked.record_delta(delta, full) {
            RecordOutcome::Recorded(_) => Some(locked.boundary()),
            RecordOutcome::Unchanged => None,
            RecordOutcome::ToolCallVanished => {
                drop(locked);
                self.revisions.reset_epoch(chat_id);
                None
            }
        }
    }

    /// Whether `chat_id` has a revision log at all — `handle_display_revision`
    /// uses this (alongside attached-connection presence) to decide whether
    /// encoding this revision is worth paying for at all.
    pub(super) fn has_revision_log(&self, chat_id: &str) -> bool {
        self.revisions.get(chat_id).is_some()
    }

    /// The chat's current revision-log boundary, if it has a log — a test
    /// seam (`revisions/tests.rs`, `tests/revision_cursor_tests.rs`); no
    /// production caller needs the boundary without also planning or
    /// seeding against the log, which already happens under its own lock
    /// in `dispatch_resume`.
    #[cfg(test)]
    pub(super) fn revision_boundary(&self, chat_id: &str) -> Option<RevisionCursor> {
        let log = self.revisions.get(chat_id)?;
        Some(log.lock_recover().boundary())
    }

    /// `TranscriptCleared`, `Resync`, and a finished `Compaction` all
    /// invalidate every cursor issued so far for `chat_id`.
    pub(super) fn reset_revision_epoch(&self, chat_id: &str) {
        self.revisions.reset_epoch(chat_id);
    }

    /// `ChatEnded`: forget the chat's log entirely.
    pub(super) fn drop_revision_log(&self, chat_id: &str) {
        self.revisions.drop_chat(chat_id);
    }
}

#[cfg(test)]
mod tests;
