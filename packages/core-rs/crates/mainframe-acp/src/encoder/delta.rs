//! `EncodedDelta` (todo #376 G2 task 2): the hub-side half of the container
//! delta contract `mainframe-display::DisplayDelta` defines on the chat
//! side. It carries one changed container's encoded items instead of its
//! `DisplayMessage`, so `SessionState`/`RevisionLog`/`SessionStream` can
//! apply a partial update without re-encoding or re-comparing settled
//! containers.
//!
//! `merge` coalesces buffered deltas the same way the hub's `buffer_op`
//! coalesces buffered revisions today — "latest wins" over the union of
//! touched ordinals, with a `full` later delta replacing everything, and a
//! `full` base delta staying `full` after a later incremental delta lands on
//! top of it (its `changes` already covers every ordinal, so the union
//! still does).

use std::collections::BTreeMap;

use super::EncodedItem;

/// A container delta over `Vec<EncodedItem>` snapshots, addressed by
/// ordinal (a top-level container's index in the encoded list).
///
/// - `full`: this delta's `changes` holds every container, ordinals
///   `0..len` — the fresh-attach / unseeded-state case, and the result of
///   merging any later `full` delta on top of an earlier one.
/// - `changes`: ascending by ordinal, later entries win on merge.
/// - `len`: the new container count; ordinals at or above `len` are
///   removed.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct EncodedDelta {
    pub full: bool,
    pub changes: Vec<(usize, Vec<EncodedItem>)>,
    pub len: usize,
}

impl EncodedDelta {
    /// Build a `full` delta from a complete per-container encoding — the
    /// shape `encode_containers` returns.
    pub fn full(containers: Vec<Vec<EncodedItem>>) -> Self {
        let len = containers.len();
        Self {
            full: true,
            changes: containers.into_iter().enumerate().collect(),
            len,
        }
    }

    /// Coalesce `self` (the earlier, buffered delta) with `later` (the one
    /// that just arrived), producing the single delta that converges a
    /// state sitting anywhere between `self`'s base and `later`'s result
    /// straight to `later`'s result.
    pub fn merge(mut self, later: Self) -> Self {
        if later.full {
            return later;
        }
        let full = self.full;
        self.changes.retain(|(ordinal, _)| *ordinal < later.len);
        let mut by_ordinal: BTreeMap<usize, Vec<EncodedItem>> =
            self.changes.into_iter().collect();
        for (ordinal, items) in later.changes {
            by_ordinal.insert(ordinal, items);
        }
        Self {
            full,
            changes: by_ordinal.into_iter().collect(),
            len: later.len,
        }
    }
}

#[cfg(test)]
mod tests;
