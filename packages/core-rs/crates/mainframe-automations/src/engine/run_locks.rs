//! Per-run mutual exclusion for the advance loop, split from `advance.rs` to
//! keep the run state machine and its locking concern under the 300-line rule.
//! Two maps: `in_flight` serializes concurrent `advance()` calls for one run so
//! a step never executes twice from a race; `cancels` lets `cancel_run` abort a
//! run's in-flight walk via a `watch` channel.

use std::collections::HashMap;
use std::sync::{Arc, Mutex as StdMutex, MutexGuard};

use tokio::sync::{Mutex as TokioMutex, watch};

pub(crate) struct RunLocks {
    in_flight: StdMutex<HashMap<String, Arc<TokioMutex<()>>>>,
    cancels: StdMutex<HashMap<String, watch::Sender<bool>>>,
}

impl RunLocks {
    pub(crate) fn new() -> Self {
        Self {
            in_flight: StdMutex::new(HashMap::new()),
            cancels: StdMutex::new(HashMap::new()),
        }
    }

    pub(crate) fn lease(&self, run_id: &str) -> Arc<TokioMutex<()>> {
        lock_map(&self.in_flight)
            .entry(run_id.to_string())
            .or_default()
            .clone()
    }

    /// Drops the per-run lock entry once nobody else holds it (checked under
    /// the map mutex, so no new clone can race the removal).
    pub(crate) fn release(&self, run_id: &str, lock: Arc<TokioMutex<()>>) {
        let mut map = lock_map(&self.in_flight);
        if map
            .get(run_id)
            .is_some_and(|entry| Arc::ptr_eq(entry, &lock) && Arc::strong_count(entry) == 2)
        {
            map.remove(run_id);
        }
    }

    pub(crate) fn register_cancel(&self, run_id: &str) -> watch::Receiver<bool> {
        let (tx, rx) = watch::channel(false);
        lock_map(&self.cancels).insert(run_id.to_string(), tx);
        rx
    }

    /// Signals a cancel to the in-flight walk, if one is registered.
    pub(crate) fn request_cancel(&self, run_id: &str) {
        if let Some(tx) = lock_map(&self.cancels).get(run_id) {
            let _ = tx.send(true);
        }
    }

    pub(crate) fn clear_cancel(&self, run_id: &str) {
        lock_map(&self.cancels).remove(run_id);
    }
}

/// Resolves when cancel is requested; pends forever otherwise (the walk
/// branch of the `select!` finishes first).
pub(crate) async fn cancel_requested(rx: &mut watch::Receiver<bool>) {
    if *rx.borrow() {
        return;
    }
    while rx.changed().await.is_ok() {
        if *rx.borrow() {
            return;
        }
    }
    std::future::pending::<()>().await
}

/// A poisoned map mutex only means another task panicked mid-insert; the
/// map itself is still coherent (db.rs precedent).
fn lock_map<T>(mutex: &StdMutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

// PORT STATUS: greenfield (docs/plans/2026-07-12-automations-v2-rust-engine.md T4.1, A8), not a TS port
// confidence: high
// notes: split out of advance.rs (300-line rule); logic verbatim, no behavior change.
