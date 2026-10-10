//! One lock per chat, held across `prepare_handoff`'s check-then-insert
//! (`handoff_send.rs`): without it, two sends that both reach
//! `prepare_handoff` for the same chat around the same time (e.g. the
//! outbox's idle flush and an independent new message) could each see no
//! live handoff yet and both build and record one, double-charging the
//! handoff into the transcript. Mirrors `config_locks.rs`'s pattern
//! (`Weak` so an unheld chat's entry is reclaimed) with its own identity,
//! since config edits and handoff preparation are different concerns that
//! should not serialize against each other.

use std::{
    collections::HashMap,
    sync::{Arc, Mutex, Weak},
};

use tokio::sync::{Mutex as AsyncMutex, OwnedMutexGuard};

#[derive(Default)]
pub(super) struct HandoffLocks(Mutex<HashMap<String, Weak<AsyncMutex<()>>>>);

impl HandoffLocks {
    pub(super) async fn acquire(&self, chat_id: &str) -> OwnedMutexGuard<()> {
        let lock = {
            let mut locks = self.0.lock().unwrap_or_else(|error| error.into_inner());
            locks.retain(|_, lock| lock.strong_count() > 0);
            match locks.get(chat_id).and_then(Weak::upgrade) {
                Some(lock) => lock,
                None => {
                    let lock = Arc::new(AsyncMutex::new(()));
                    locks.insert(chat_id.to_string(), Arc::downgrade(&lock));
                    lock
                }
            }
        };
        lock.lock_owned().await
    }
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use super::*;

    #[tokio::test]
    async fn a_waiting_chat_does_not_block_another() {
        let locks = HandoffLocks::default();
        let first = locks.acquire("first").await;
        let later = locks.acquire("first");
        tokio::pin!(later);
        assert!(
            std::future::poll_fn(|cx| {
                std::task::Poll::Ready(std::future::Future::poll(later.as_mut(), cx).is_pending())
            })
            .await
        );
        let other = tokio::time::timeout(Duration::from_secs(1), locks.acquire("other"))
            .await
            .expect("an unrelated chat must remain independent");
        drop(other);
        drop(first);
        tokio::time::timeout(Duration::from_secs(1), later)
            .await
            .expect("the queued send must continue once the first finishes");
    }
}
