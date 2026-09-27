use std::{
    collections::HashMap,
    sync::{Arc, Mutex, Weak},
};

use tokio::sync::{Mutex as AsyncMutex, OwnedMutexGuard};

#[derive(Default)]
pub(super) struct ConfigLocks(Mutex<HashMap<String, Weak<AsyncMutex<()>>>>);

impl ConfigLocks {
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
    use super::*;
    use std::time::Duration;

    #[tokio::test]
    async fn a_waiting_change_does_not_block_other_chats() {
        let locks = ConfigLocks::default();
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
            .expect("the queued change must continue");
    }
}
