//! `mainframe-background-tasks` — background-task tracking, spool walking, and
//! process-group kill/liveness reconciliation.
#![forbid(unsafe_code)]
#![cfg_attr(
    test,
    allow(clippy::too_many_lines, clippy::unwrap_used, clippy::expect_used)
)]

pub mod encoding;
pub mod kill;
pub mod liveness;
pub mod lsof;
pub mod process;
pub mod reconcile;
pub mod spool_root;
pub mod spool_validator;
pub mod spool_walker;
pub mod tracker;

pub mod workflow_sink;
