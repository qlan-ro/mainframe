//! A cheap `Arc` handle onto a projector's materialized container list. For
//! `IncrementalProjector` this list is the only copy of the containers: its
//! fold state refers to them by ordinal rather than holding its own.
//!
//! `materialize()` is only valid during the synchronous `notify` call that
//! carries the [`super::DisplayDelta`] referencing it — the projector may
//! mutate the underlying list in place on its next `project` call. It sits
//! behind its own mutex, never the `MessageCache` lock, so a consumer can
//! call it while `emit_display_for` still holds the cache lock (lock order:
//! cache lock, then this mutex — never the reverse).
//!
//! `IncrementalProjector` holds this mutex for its whole `project` call, so a
//! panic during projection poisons it. Readers recover the poisoned lock and
//! still see real containers: the projector's unwind guard
//! (`incremental/projector/park.rs`) puts back any container it had moved
//! out before the lock is released, and forces the next call to rebuild in
//! full. Only this crate's projectors write the list.

use mainframe_types::sync::LockExt as _;
use std::sync::{Arc, Mutex};

use mainframe_types::display::DisplayMessage;

#[derive(Clone)]
pub struct DisplaySnapshot(Arc<Mutex<Vec<DisplayMessage>>>);

impl DisplaySnapshot {
    pub fn new(initial: Vec<DisplayMessage>) -> Self {
        Self(Arc::new(Mutex::new(initial)))
    }

    /// Clone the current container list. Correct only inside the synchronous
    /// call that produced the delta carrying this handle.
    pub fn materialize(&self) -> Vec<DisplayMessage> {
        self.lock_inner().clone()
    }

    pub fn read<R>(&self, read: impl FnOnce(&[DisplayMessage]) -> R) -> R {
        read(&self.lock_inner())
    }

    /// Replace the whole list (a full rebuild).
    pub(crate) fn replace(&self, list: Vec<DisplayMessage>) {
        *self.lock_inner() = list;
    }

    /// Mutate the list in place, returning the closure's result.
    pub(crate) fn with_mut<R>(&self, f: impl FnOnce(&mut Vec<DisplayMessage>) -> R) -> R {
        f(&mut self.lock_inner())
    }

    fn lock_inner(&self) -> std::sync::MutexGuard<'_, Vec<DisplayMessage>> {
        // Recover from poisoning instead of `.unwrap()`/`.expect()` (both
        // denied by workspace lint). Projection runs under this mutex
        // (`IncrementalProjector::project`), so a panic there poisons it; the
        // projector's unwind guard leaves the list holding real containers,
        // and a stale snapshot beats a crash in the display path.
        self.0.lock_recover()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use mainframe_types::display::DisplayMessageType;

    fn msg(id: &str) -> DisplayMessage {
        DisplayMessage {
            id: id.to_string(),
            chat_id: "c".to_string(),
            r#type: DisplayMessageType::User,
            content: Vec::new(),
            timestamp: "t".to_string(),
            metadata: None,
        }
    }

    #[test]
    fn materialize_clones_the_current_list() {
        let snapshot = DisplaySnapshot::new(vec![msg("a")]);
        let first = snapshot.materialize();
        snapshot.replace(vec![msg("a"), msg("b")]);
        let second = snapshot.materialize();
        assert_eq!(first.len(), 1);
        assert_eq!(second.len(), 2);
    }

    #[test]
    fn with_mut_mutates_in_place_and_is_visible_to_clones() {
        let snapshot = DisplaySnapshot::new(vec![msg("a")]);
        let clone = snapshot.clone();
        snapshot.with_mut(|list| list.push(msg("b")));
        assert_eq!(clone.materialize().len(), 2);
    }
}
