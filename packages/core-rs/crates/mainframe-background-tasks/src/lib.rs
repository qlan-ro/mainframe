//! Background-task tracking for CLI sessions: the in-memory tracker, the
//! Claude CLI spool layout, recovery after a daemon restart, liveness sweeps,
//! and killing a task's processes.
#![forbid(unsafe_code)]
#![cfg_attr(
    test,
    allow(
        clippy::too_many_lines,
        clippy::unwrap_used,
        clippy::expect_used,
        reason = "Test assertions and scenarios"
    )
)]

pub mod encoding;
pub mod kill;
pub mod liveness;
mod lsof;
mod process;
pub mod reconcile;
pub mod spool_root;
mod spool_walker;
pub mod tracker;
