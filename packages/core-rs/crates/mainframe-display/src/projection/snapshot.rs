//! A cheap `Arc` handle onto a projector's materialized container list.
//!
//! `materialize()` is only valid during the synchronous `notify` call that
//! carries the [`super::DisplayDelta`] referencing it — the projector may
//! mutate the underlying list in place on its next `project` call. It sits
//! behind its own mutex, never the `MessageCache` lock, so a consumer can
//! call it while `emit_display_for` still holds the cache lock (lock order:
//! cache lock, then this mutex — never the reverse).

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

    /// Replace the whole list (a full rebuild).
    pub fn replace(&self, list: Vec<DisplayMessage>) {
        *self.lock_inner() = list;
    }

    /// Mutate the list in place, returning the closure's result.
    pub fn with_mut<R>(&self, f: impl FnOnce(&mut Vec<DisplayMessage>) -> R) -> R {
        f(&mut self.lock_inner())
    }

    fn lock_inner(&self) -> std::sync::MutexGuard<'_, Vec<DisplayMessage>> {
        // Recover from poisoning instead of `.unwrap()`/`.expect()` (both
        // denied by workspace lint): no panic ever runs while this mutex is
        // held, so poisoning should not occur, but a stale snapshot beats a
        // crash in the display path.
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
