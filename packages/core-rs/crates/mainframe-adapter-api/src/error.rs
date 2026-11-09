//! [`AdapterError`], the error type of the adapter contract.

/// Errors surfaced across the adapter contract. The texts reach the chat's
/// error banner and REST bodies verbatim.
#[derive(Debug, thiserror::Error)]
pub enum AdapterError {
    /// An error carried as plain text: the CLI's own `error` events, JSON-RPC
    /// error replies and recorded fixture failures, plus the daemon-side
    /// plan-mode relay (`SendError::into_adapter_error` in the chat crate),
    /// which has no richer channel through this crate.
    #[error("{0}")]
    Message(String),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
    #[error(transparent)]
    Exec(#[from] mainframe_runtime::process::ExecError),
    /// The session's CLI process has not been spawned yet (or has exited).
    #[error("Session {0} not spawned")]
    NotSpawned(String),
    #[error("Session {0} stdin queue is full")]
    StdinFull(String),
    #[error("Session {0} has no active turn to steer")]
    NoActiveTurn(String),
    /// The adapter has no mechanism for the operation (`"steer a running turn"`).
    #[error("this adapter cannot {0}")]
    Unsupported(&'static str),
    #[error("Project directory does not exist or is not accessible: {0}")]
    ProjectDirMissing(String),
    /// A helper process could not be started (`"title binary"`).
    #[error("failed to spawn {what} {binary}: {source}")]
    Spawn {
        what: &'static str,
        binary: String,
        #[source]
        source: std::io::Error,
    },
    /// The full text names the operation that ran out of time.
    #[error("{0}")]
    Timeout(&'static str),
    /// A helper process exited unsuccessfully; `detail` is its status and,
    /// when there is one, its stderr.
    #[error("{what} exited with {detail}")]
    Exited { what: &'static str, detail: String },
    /// The CLI answered a control request with anything but success.
    #[error("{subtype} failed: {reason}")]
    ControlFailed { subtype: String, reason: String },
    /// Something the session needs (a resolved model, the model proxy) is not
    /// available; the static text tells the user what to do.
    #[error("{0}")]
    Unavailable(&'static str),
    /// The provider archived the chat's native session outside Mainframe (a
    /// Codex thread archived in the Codex app or with `codex archive`) and
    /// refuses to continue it until it is unarchived. The text is the full
    /// user-facing explanation; [`crate::Adapter::unarchive_native_session`]
    /// is the remedy.
    #[error("{0}")]
    NativeSessionArchived(String),
    /// The adapter's own bookkeeping contradicts itself (a spawn that left no
    /// process info). Never the user's doing.
    #[error("{0}")]
    Invariant(&'static str),
}
