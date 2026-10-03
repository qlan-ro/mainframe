//! The container-delta half of [`RevisionLog`] (todo #376 G2 task 4):
//! `seed_containers` and `record_delta` mirror `session_state/containers.rs`
//! exactly, over this log's `(revision, EncodedItem)` records instead of
//! bare items. The outcomes, revision stamps, and tombstones `record_delta`
//! produces for an equivalent sequence of snapshots must match `record`'s —
//! only the work to reach them differs.

use std::collections::HashSet;

use super::{RecordOutcome, RevisionLog};
use crate::encoder::EncodedItem;
use crate::encoder::delta::EncodedDelta;

impl RevisionLog {
    /// Mark `containers` as the baseline at the current revision, with no
    /// bump — only takes effect the first time, while the log is unseeded.
    pub fn seed_containers(&mut self, containers: &[Vec<EncodedItem>]) {
        if self.seeded {
            return;
        }
        self.seeded = true;
        for items in containers {
            for item in items {
                self.items
                    .insert(item.id().to_string(), (self.revision, item.clone()));
            }
        }
        self.set_container_index(containers);
    }

    /// Record one container delta. `full` is called only when this log is
    /// unseeded and `delta` is incremental — the fresh-attach path, which
    /// `record_delta` must still record in full exactly as `record` does
    /// today.
    pub fn record_delta(
        &mut self,
        delta: &EncodedDelta,
        full: impl FnOnce() -> Vec<Vec<EncodedItem>>,
    ) -> RecordOutcome {
        if delta.full {
            return self.record_full(&delta_containers(delta));
        }
        if !self.seeded {
            return self.record_full(&full());
        }
        self.record_incremental(delta)
    }

    fn record_full(&mut self, containers: &[Vec<EncodedItem>]) -> RecordOutcome {
        let flattened: Vec<EncodedItem> = containers.iter().flatten().cloned().collect();
        let outcome = self.record(&flattened);
        if !matches!(outcome, RecordOutcome::ToolCallVanished) {
            self.set_container_index(containers);
        }
        outcome
    }

    fn record_incremental(&mut self, delta: &EncodedDelta) -> RecordOutcome {
        let old_ids = self.old_ids_for(delta);
        let new_ids: HashSet<&str> = delta
            .changes
            .iter()
            .flat_map(|(_, items)| items.iter().map(EncodedItem::id))
            .collect();

        let mut vanished_ids = Vec::new();
        for id in &old_ids {
            if new_ids.contains(id.as_str()) {
                continue;
            }
            if let Some((_, item)) = self.items.get(id.as_str())
                && matches!(item, EncodedItem::ToolCall { .. })
            {
                return RecordOutcome::ToolCallVanished;
            }
            vanished_ids.push(id.clone());
        }

        self.items_compared += delta.changes.iter().map(|(_, items)| items.len() as u64).sum::<u64>();
        let changed_items: Vec<&EncodedItem> = delta
            .changes
            .iter()
            .flat_map(|(_, items)| items.iter())
            .filter(|item| !matches!(self.items.get(item.id()), Some((_, prev)) if prev == *item))
            .collect();

        if vanished_ids.is_empty() && changed_items.is_empty() {
            self.update_container_index(delta);
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
        for item in changed_items {
            self.items
                .insert(item.id().to_string(), (rev, item.clone()));
        }
        self.update_container_index(delta);
        RecordOutcome::Recorded(rev)
    }

    /// The old ids owned by every ordinal this delta touches — the changed
    /// ordinals, plus any ordinal at or above the new `len` (removed).
    fn old_ids_for(&self, delta: &EncodedDelta) -> HashSet<String> {
        let mut ids = HashSet::new();
        for (ordinal, _) in &delta.changes {
            if let Some(container_ids) = self.containers.get(*ordinal) {
                ids.extend(container_ids.iter().cloned());
            }
        }
        for container_ids in self.containers.iter().skip(delta.len) {
            ids.extend(container_ids.iter().cloned());
        }
        ids
    }

    fn update_container_index(&mut self, delta: &EncodedDelta) {
        if self.containers.len() < delta.len {
            self.containers.resize(delta.len, Vec::new());
        }
        for (ordinal, items) in &delta.changes {
            self.containers[*ordinal] = items.iter().map(|item| item.id().to_string()).collect();
        }
        self.containers.truncate(delta.len);
    }

    fn set_container_index(&mut self, containers: &[Vec<EncodedItem>]) {
        self.containers = containers
            .iter()
            .map(|items| items.iter().map(|item| item.id().to_string()).collect())
            .collect();
    }
}

/// `delta.changes`, ascending by ordinal, as a plain per-container list —
/// valid only for a `full` delta, whose `changes` covers every ordinal
/// `0..len` by construction (`EncodedDelta::full`).
fn delta_containers(delta: &EncodedDelta) -> Vec<Vec<EncodedItem>> {
    delta
        .changes
        .iter()
        .map(|(_, items)| items.clone())
        .collect()
}

#[cfg(test)]
mod tests;
