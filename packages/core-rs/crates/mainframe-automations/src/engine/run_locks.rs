//! Per-run mutual exclusion for the advance loop, split from `advance.rs` to
//! keep the run state machine and its locking concern under the 300-line rule.
//! Two maps: `in_flight` serializes concurrent `advance()` calls for one run so
//! a step never executes twice from a race; `cancels` lets `cancel_run` abort a
//! run's in-flight walk via a `watch` channel.

use mainframe_types::sync::LockExt as _;
use std::collections::HashMap;
use std::sync::{Arc, Mutex as StdMutex};

use tokio::sync::{Mutex as TokioMutex, watch};

pub(crate) struct RunLocks {
    in_flight: mainframe_runtime::sync::KeyedMutex,
    cancels: StdMutex<HashMap<String, watch::Sender<bool>>>,
}

impl RunLocks {
    pub(crate) fn new() -> Self {
        Self {
            in_flight: mainframe_runtime::sync::KeyedMutex::default(),
            cancels: StdMutex::new(HashMap::new()),
        }
    }

    pub(crate) fn lease(&self, run_id: &str) -> Arc<TokioMutex<()>> {
        self.in_flight.get(run_id)
    }

    pub(crate) fn register_cancel(&self, run_id: &str) -> watch::Receiver<bool> {
        let (tx, rx) = watch::channel(false);
        self.cancels.lock_recover().insert(run_id.to_string(), tx);
        rx
    }

    /// Signals a cancel to the in-flight walk, if one is registered.
    pub(crate) fn request_cancel(&self, run_id: &str) {
        if let Some(tx) = self.cancels.lock_recover().get(run_id) {
            let _ = tx.send(true);
        }
    }

    pub(crate) fn clear_cancel(&self, run_id: &str) {
        self.cancels.lock_recover().remove(run_id);
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
