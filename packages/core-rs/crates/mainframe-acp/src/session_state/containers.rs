//! The container-delta half of [`SessionState`] (todo #376 G2 task 3):
//! `seed_containers` and `apply` let a hub that encodes only changed
//! containers (`encoder::encode_containers`) update the diff state without
//! re-comparing settled ones. `apply`'s output equals `diff` on the
//! flattened snapshots, minus the no-op entries an untouched container
//! would have produced anyway — `diff` never emits anything for an
//! unchanged item, so excluding it from comparison changes nothing about
//! the result, only the work done to reach it.

use std::collections::HashSet;

use mainframe_types::acp::update::SessionUpdate;

use super::updates::{clear_update, create_update};
use super::{SessionState, revise_update};
use crate::encoder::EncodedItem;
use crate::encoder::delta::EncodedDelta;

impl SessionState {
    /// Mark `containers` as the known baseline with no updates emitted —
    /// the resume-replay seed path (mirrors [`crate::revision_log::RevisionLog::seed`]).
    /// Only takes effect the first time, while the state is unseeded.
    pub fn seed_containers(&mut self, containers: &[Vec<EncodedItem>]) {
        if self.seeded {
            return;
        }
        self.seeded = true;
        for items in containers {
            for item in items {
                self.items.insert(item.id().to_string(), item.clone());
            }
        }
        self.set_container_index(containers);
    }

    /// Apply one container delta, returning the same `session/update`
    /// payloads `diff` would have produced on the flattened result.
    ///
    /// `full` is called only when this state is unseeded and `delta` is
    /// incremental — the fresh-`attach` path, where the hub has no prior
    /// state to delta against yet but still only computed an incremental
    /// delta for this revision. Reproduces "a session's first revision
    /// creates every item" exactly.
    pub fn apply(
        &mut self,
        delta: &EncodedDelta,
        full: impl FnOnce() -> Vec<Vec<EncodedItem>>,
    ) -> Vec<SessionUpdate> {
        if delta.full {
            return self.apply_full(&delta_containers(delta));
        }
        if !self.seeded {
            return self.apply_full(&full());
        }
        self.apply_incremental(delta)
    }

    /// A full delta/snapshot behaves exactly like `diff` on the flattened
    /// container list, with the container index rebuilt to match.
    fn apply_full(&mut self, containers: &[Vec<EncodedItem>]) -> Vec<SessionUpdate> {
        let flattened: Vec<EncodedItem> = containers.iter().flatten().cloned().collect();
        let updates = self.diff(&flattened);
        self.set_container_index(containers);
        updates
    }

    /// The incremental path (todo #376 G2 task 3 steps 1-4): clear whatever
    /// the affected and removed ordinals' old ids no longer cover, then
    /// create or revise exactly the changed containers' items, comparing
    /// only them.
    fn apply_incremental(&mut self, delta: &EncodedDelta) -> Vec<SessionUpdate> {
        let old_ids = self.old_ids_for(delta);
        let new_ids: HashSet<&str> = delta
            .changes
            .iter()
            .flat_map(|(_, items)| items.iter().map(EncodedItem::id))
            .collect();

        let mut vanished: Vec<String> = old_ids
            .into_iter()
            .filter(|id| !new_ids.contains(id.as_str()))
            .filter(|id| !matches!(self.items.get(id), Some(EncodedItem::ToolCall { .. })))
            .collect();
        vanished.sort();
        let mut updates: Vec<SessionUpdate> = vanished
            .into_iter()
            .filter_map(|id| self.items.remove(&id))
            .map(|item| clear_update(&item))
            .collect();

        for (_, items) in &delta.changes {
            for item in items {
                self.items_compared += 1;
                match self.items.get(item.id()) {
                    None => updates.push(create_update(item)),
                    Some(prev) if prev == item => {}
                    Some(prev) => updates.extend(revise_update(prev, item)),
                }
                self.items.insert(item.id().to_string(), item.clone());
            }
        }

        self.update_container_index(delta);
        updates
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
    delta.changes.iter().map(|(_, items)| items.clone()).collect()
}

#[cfg(test)]
mod tests;
