//! Typed store errors (thiserror — no anyhow in library crates). Display
//! strings that mirror the Node engine are load-bearing: they cross the wire
//! through run/step `error` fields.

use crate::store::RunStatus;

pub const MAX_STEP_OUTPUT_BYTES: usize = 4 * 1024 * 1024;

#[derive(Debug, thiserror::Error)]
pub enum StoreError {
    /// A8 — terminal runs are immutable; a late writer must never resurrect
    /// or overwrite a finished run.
    #[error("automation run '{run_id}' is already terminal ({status})")]
    TerminalRun { run_id: String, status: RunStatus },

    /// The loser of the `(automation_id, trigger_dedup_key)` insert race —
    /// dedup is a DB uniqueness invariant, not check-then-create (contract §3).
    #[error("duplicate trigger fire for automation '{automation_id}' (dedup key '{dedup_key}')")]
    DuplicateFire {
        automation_id: String,
        dedup_key: String,
    },

    #[error("{kind} not found: {id}")]
    NotFound { kind: &'static str, id: String },

    /// Per-step outputs cap (contract §2) — loud, actionable failure.
    #[error(
        "step '{step_ref}' outputs too large ({bytes} bytes > {max}); write large data to a file and pass the path",
        max = MAX_STEP_OUTPUT_BYTES
    )]
    StepOutputsTooLarge { step_ref: String, bytes: usize },

    /// The engine's ask_me resolution found no parked step to answer.
    #[error("ask_me step '{step_ref}' not found in checkpoint")]
    StepNotInCheckpoint { step_ref: String },

    /// Malformed persisted JSON — surfaced as a typed error, never a panic.
    #[error("corrupt {what} for {id}: {source}")]
    Corrupt {
        what: &'static str,
        id: String,
        #[source]
        source: serde_json::Error,
    },

    #[error(transparent)]
    Sqlite(#[from] rusqlite::Error),

    #[error(transparent)]
    Json(#[from] serde_json::Error),

    #[error(transparent)]
    Io(#[from] std::io::Error),

    /// A `spawn_blocking` worker was cancelled or panicked.
    #[error("store task failed: {0}")]
    Task(String),
}

// PORT STATUS: greenfield (docs/plans/2026-07-12-automations-v2-rust-engine.md T2.1-T2.2), not a TS port
// confidence: high
// todos: 0
// notes: TerminalRun/OutputsTooLarge display text mirrors Node's
//        store/types.ts + run-store.ts error strings.
