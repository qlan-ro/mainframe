//! `mainframe-background-tasks` — background-task tracking, spool walking, and
//! process-group kill/liveness reconciliation.
//!
//! Ported from `packages/core/src/background-tasks/*` (one `.rs` per `.ts`, crate
//! map §2.11).
#![forbid(unsafe_code)]
// Tests hold the process-wide seam guard (`seam_test_guard`) across `.await` on
// purpose — it serializes the global lsof/kill test seams for the whole test body.
#![cfg_attr(
    test,
    allow(clippy::unwrap_used, clippy::expect_used, clippy::await_holding_lock)
)]

pub mod encoding;
pub mod kill;
pub mod liveness;
pub mod lsof;
pub mod reconcile;
pub mod spool_root;
pub mod spool_validator;
pub mod spool_walker;
pub mod tracker;

/// Serializes the process-wide test seams (lsof exec/logger, kill tree-kill/ps).
/// Cargo runs a crate's tests on parallel threads that share these globals, so
/// every seam-mutating test holds this guard for its duration.
#[cfg(test)]
pub(crate) fn seam_test_guard() -> std::sync::MutexGuard<'static, ()> {
    static LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
    LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

// PORT STATUS: src/background-tasks/* (lib.rs — module mount + shared test lock)
// confidence: high
// todos: 0
// notes: tracker owns the SHARED_MAP byChat/pidByChat + BROADCAST emitter
// (CONCURRENCY.tsv). `seam_test_guard()` serializes lsof/kill global test seams
// (the TS module-level `_exec`/`_log`/tree-kill mock seams) across parallel test
// threads.
