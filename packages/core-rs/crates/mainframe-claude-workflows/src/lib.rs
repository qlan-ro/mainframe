//! The Claude CLI `/workflows` run store.
//!
//! Holds the daemon's per-chat view of a `/workflows` script run: seeded from
//! `task_started`, kept live by `task_progress` snapshots and reconciled
//! against the on-disk `wf_<runId>.json` record once the run goes terminal.
//! See `docs/plans/2026-07-30-todo-233-workflow-details-card-plan.md`.

pub mod bridge;
pub mod merge;
pub mod reconcile;
pub mod record;
pub mod snapshot;
pub mod status;
pub mod store;
mod store_mutations;
