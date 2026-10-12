use super::LockExt;
use std::collections::HashMap;
use std::sync::{Arc, Mutex, Weak};
use tokio::sync::{Mutex as AsyncMutex, OwnedMutexGuard};

/// Weak entries keep owners and queued callers on the same lock. Every lookup
/// evicts idle entries while holding the map lock, before creating a new owner.
#[derive(Default)]
pub struct KeyedMutex(Mutex<HashMap<String, Weak<AsyncMutex<()>>>>);

impl KeyedMutex {
    pub fn get(&self, key: &str) -> Arc<AsyncMutex<()>> {
        let mut locks = self.0.lock_recover();
        locks.retain(|_, lock| lock.strong_count() > 0);
        if let Some(lock) = locks.get(key).and_then(Weak::upgrade) {
            return lock;
        }
        let lock = Arc::new(AsyncMutex::new(()));
        locks.insert(key.to_string(), Arc::downgrade(&lock));
        lock
    }

    pub async fn acquire(&self, key: &str) -> OwnedMutexGuard<()> {
        self.get(key).lock_owned().await
    }

    pub fn prune(&self) {
        self.0
            .lock_recover()
            .retain(|_, lock| lock.strong_count() > 0);
    }
}

#[cfg(test)]
#[path = "keyed_mutex_tests.rs"]
mod tests;
