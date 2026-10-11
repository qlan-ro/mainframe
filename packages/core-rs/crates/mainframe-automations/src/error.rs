//! Typed store errors (thiserror — no anyhow in library crates). Display
//! strings are load-bearing: they cross the wire through run/step `error`
//! fields.

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

    /// The `spawn_blocking` open task was cancelled or panicked.
    #[error("store task failed: {0}")]
    Task(#[from] tokio::task::JoinError),

    /// A store operation panicked on the worker; the connection survives.
    #[error("store task failed: database operation panicked")]
    Panicked,

    /// The worker thread that owns the automation store could not take or
    /// answer the request.
    #[error("store task failed: database worker {0}")]
    Worker(&'static str),

    /// A daemon-store failure with no automation-specific shape.
    #[error("store task failed: {0}")]
    Db(mainframe_db::DbError),

    /// The built-in action registry refused a manifest at boot.
    #[error("store task failed: action registry: {0}")]
    ActionRegistry(#[source] crate::actions::ActionError),
}
