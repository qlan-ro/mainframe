//! Per-chat revision log: a pure, in-memory record of which [`EncodedItem`]s a
//! chat's `RevisionCursor` boundary has already covered, so `session/resume`
//! can send exactly what changed since a reconnecting client's last cursor
//! instead of replaying item cursors (which only ever resume strictly after the
//! named item and so miss a later edit to an earlier one).
//!
//! `mainframe-server`'s hub owns one log per chat (an `Arc<Mutex<Self>>` in a
//! bounded registry) and calls [`RevisionLog::record`] on every display
//! revision, whether or not a connection is attached — revision accounting
//! must not depend on connection presence, or an unobserved change could
//! silently disappear from a later resume. `session/resume` calls
//! [`RevisionLog::plan`] under that same lock, after its own snapshot read.

use std::collections::{HashMap, HashSet, VecDeque};

use mainframe_types::acp::extensions::RevisionCursor;
use mainframe_types::acp::update::SessionUpdate;

use crate::encoder::EncodedItem;
use crate::session_state::updates::{clear_update, create_update};

/// Bound on retained tombstones (vanished messages/thoughts) per chat. Past
/// this, the oldest tombstone is evicted and [`RevisionLog::floor`] rises
/// past its revision — a cursor that old can no longer be served
/// incrementally and [`RevisionLog::plan`] falls back to a full replay.
const MAX_TOMBSTONES: usize = 256;

/// What [`RevisionLog::record`] did with one display revision.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RecordOutcome {
    /// Nothing differed from the log's last-known state; the revision
    /// counter did not move.
    Unchanged,
    /// At least one item changed, was created, or vanished; this is the new
    /// current revision.
    Recorded(u64),
    /// A tool call vanished from the snapshot. Live diffs never clear a
    /// vanished tool call ([`crate::session_state::SessionState::diff`]), so
    /// this log has no way to express the removal as a revisioned change —
    /// the caller must rotate the chat onto a fresh epoch instead of
    /// recording.
    ToolCallVanished,
}

/// What [`RevisionLog::plan`] decided a resume should do.
#[derive(Debug, Clone, PartialEq)]
pub enum ReplayPlan {
    /// The cursor cannot be served incrementally — unknown epoch, evicted
    /// tombstone range, a revision ahead of the log, or a log tool call the
    /// snapshot no longer has. The caller falls back to a full item-cursor
    /// replay and reports `fullReplay: true`.
    Full,
    /// Exactly the updates needed to converge a client holding `cursor`'s
    /// state to the current snapshot: clears for anything gone, creates for
    /// anything new, changed, or newer than the cursor.
    Incremental(Vec<SessionUpdate>),
}

/// One chat's revision history. `epoch` identifies the log generation — a
/// daemon restart, a transcript clear, a resync, a finished compaction, or a
/// tool-call vanish (which this log cannot express as a revisioned change)
/// all rotate it by replacing the log with a fresh one, which invalidates
/// every cursor issued against the old epoch outright rather than trying to
/// reinterpret an old revision against reconstructed state.
pub struct RevisionLog {
    epoch: String,
    revision: u64,
    seeded: bool,
    items: HashMap<String, (u64, EncodedItem)>,
    tombstones: VecDeque<(u64, EncodedItem)>,
    /// The highest revision evicted from `tombstones`. A cursor at or below
    /// this floor cannot be served incrementally — its retained tombstone
    /// range is gone.
    floor: u64,
    /// Per-ordinal item ids — the same container index
    /// `session_state/containers.rs` keeps, so `record_delta` can find an
    /// affected or removed ordinal's old ids without scanning every item.
    /// Maintained only by `record_delta`/`seed_containers`; `record`/`seed`
    /// (the flat path) leave it alone.
    containers: crate::container_index::ContainerIndex,
    /// Cumulative count of items `record`/`record_delta` has compared
    /// against their previous value — the deterministic gate an
    /// incremental `record_delta` must not grow past the affected
    /// containers' item count.
    items_compared: u64,
}

impl RevisionLog {
    pub fn new(epoch: String) -> Self {
        Self {
            epoch,
            revision: 0,
            seeded: false,
            items: HashMap::new(),
            tombstones: VecDeque::new(),
            floor: 0,
            containers: crate::container_index::ContainerIndex::default(),
            items_compared: 0,
        }
    }

    pub fn items_compared(&self) -> u64 {
        self.items_compared
    }

    /// Mark `items` as the baseline at the current revision, with no bump —
    /// only takes effect the first time, while the log is unseeded. A
    /// `session/resume` whose log has never recorded anything calls this
    /// with the resume snapshot so later live revisions delta against what
    /// that reply actually sent.
    pub fn seed(&mut self, items: &[EncodedItem]) {
        if self.seeded {
            return;
        }
        self.seeded = true;
        for item in items {
            self.items
                .insert(item.id().to_string(), (self.revision, item.clone()));
        }
    }

    /// Record one display revision: one bump, only when something actually
    /// changed. A changed or newly-present item is stamped with the new
    /// revision; an item unchanged since its last record keeps its old one,
    /// so [`Self::plan`] can tell "not yet seen past the cursor" apart from
    /// "touched since".
    pub fn record(&mut self, items: &[EncodedItem]) -> RecordOutcome {
        let new_ids: HashSet<&str> = items.iter().map(EncodedItem::id).collect();
        let mut vanished_ids = Vec::new();
        for (id, (_, item)) in &self.items {
            if new_ids.contains(id.as_str()) {
                continue;
            }
            if matches!(item, EncodedItem::ToolCall { .. }) {
                return RecordOutcome::ToolCallVanished;
            }
            vanished_ids.push(id.clone());
        }

        self.items_compared += items.len() as u64;
        let changed_ids: Vec<&EncodedItem> = items
            .iter()
            .filter(|item| !matches!(self.items.get(item.id()), Some((_, prev)) if prev == *item))
            .collect();
        if vanished_ids.is_empty() && changed_ids.is_empty() {
            return RecordOutcome::Unchanged;
        }

        self.revision += 1;
        let rev = self.revision;
        self.seeded = true;
        for id in vanished_ids {
            if let Some((_, item)) = self.items.remove(&id) {
                self.push_tombstone(rev, item);
            }
        }
        for item in changed_ids {
            self.items
                .insert(item.id().to_string(), (rev, item.clone()));
        }
        RecordOutcome::Recorded(rev)
    }

    /// The replay boundary a `session/resume` reply or `_mainframe.dev/cursor`
    /// notification carries for this log's current state.
    pub fn boundary(&self) -> RevisionCursor {
        RevisionCursor {
            epoch: self.epoch.clone(),
            revision: self.revision,
        }
    }

    /// Decide how to serve a resume against `cursor`, given the fresh
    /// snapshot `session/resume` just read. See the module doc for the
    /// invariants this leans on (the resume-snapshot/display-emission lock
    /// race, and tool calls never clearing live).
    pub fn plan(&self, cursor: &RevisionCursor, snapshot_items: &[EncodedItem]) -> ReplayPlan {
        if cursor.epoch != self.epoch
            || cursor.revision < self.floor
            || cursor.revision > self.revision
        {
            return ReplayPlan::Full;
        }
        let snapshot_ids: HashMap<&str, &EncodedItem> = snapshot_items
            .iter()
            .map(|item| (item.id(), item))
            .collect();
        let missing_tool_call = self.items.values().any(|(_, item)| {
            matches!(item, EncodedItem::ToolCall { .. }) && !snapshot_ids.contains_key(item.id())
        });
        if missing_tool_call {
            return ReplayPlan::Full;
        }

        let mut updates = Vec::new();
        let mut cleared_ids: Vec<&String> = self
            .items
            .keys()
            .filter(|id| !snapshot_ids.contains_key(id.as_str()))
            .collect();
        cleared_ids.sort();
        for id in cleared_ids {
            let (_, item) = &self.items[id];
            updates.push(clear_update(item));
        }
        for (rev, item) in &self.tombstones {
            if *rev > cursor.revision && !snapshot_ids.contains_key(item.id()) {
                updates.push(clear_update(item));
            }
        }
        for item in snapshot_items {
            let needs_create = match self.items.get(item.id()) {
                None => true,
                Some((rev, log_item)) => *rev > cursor.revision || log_item != item,
            };
            if needs_create {
                updates.push(create_update(item));
            }
        }
        ReplayPlan::Incremental(updates)
    }

    fn push_tombstone(&mut self, rev: u64, item: EncodedItem) {
        self.tombstones.push_back((rev, item));
        if self.tombstones.len() > MAX_TOMBSTONES
            && let Some((evicted_rev, _)) = self.tombstones.pop_front()
        {
            self.floor = self.floor.max(evicted_rev);
        }
    }
}

mod delta;

#[cfg(test)]
mod tests;
