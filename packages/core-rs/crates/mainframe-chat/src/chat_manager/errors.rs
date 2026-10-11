//! Command metadata plus the error/parameter types `send_message` and its
//! sibling delegations surface across the wire.
use super::*;
use mainframe_types::http_status::{HttpStatus, NotFound, StatusKind};
use mainframe_types::seam_error::SeamError;

/// `metadata.command` for `sendMessage` (`{ name, source, args? }`).
#[derive(Debug, Clone)]
pub struct CommandMeta {
    pub name: String,
    pub source: String,
    pub args: Option<String>,
}

/// Error surfaced by `sendMessage`/queue ops. The texts cross the wire.
#[derive(Debug, thiserror::Error)]
pub enum SendError {
    #[error("Chat {0} not running")]
    NotRunning(String),
    #[error("Chat {0}'s adapter cannot steer a running turn")]
    SteerUnsupported(String),
    #[error("Chat {0} has no active turn")]
    NoActiveTurn(String),
    /// The message plus the context handoff exceeds the target provider's
    /// budget. Carries the provider's display name.
    #[error(
        "This message is too large to send with {0}'s context handoff. Shorten it or remove attachments."
    )]
    HandoffTooLarge(String),
    #[error(transparent)]
    Adapter(#[from] AdapterError),
    #[error(transparent)]
    Recovery(#[from] DegradedRecoveryError),
    /// The segment store refused a write the send needs.
    #[error(transparent)]
    Store(#[from] SeamError),
}

impl SendError {
    /// The plan-mode follow-up send answers the adapter's handler, whose seam
    /// speaks `AdapterError`: an adapter failure passes through unchanged and
    /// any other refusal reaches it as its text.
    pub(crate) fn into_adapter_error(self) -> AdapterError {
        match self {
            Self::Adapter(error) => error,
            other => AdapterError::Message(other.to_string()),
        }
    }
}

/// Error surfaced by `trust_workspace` (its message crosses the wire).
#[derive(Debug, thiserror::Error)]
pub enum TrustWorkspaceError {
    #[error("Chat {0} not found")]
    ChatNotFound(String),
    #[error("Project {0} not found")]
    ProjectNotFound(String),
    #[error(transparent)]
    Write(#[from] SeamError),
}

impl HttpStatus for TrustWorkspaceError {
    fn status_kind(&self) -> StatusKind {
        match self {
            Self::ChatNotFound(_) | Self::ProjectNotFound(_) => StatusKind::NotFound,
            Self::Write(_) => StatusKind::Internal,
        }
    }
}

/// Error surfaced by `fork_to_worktree` (the create step is fallible, the enable step
/// too). A dirty tree is a 409; the rest take their own step's status.
#[derive(Debug, thiserror::Error)]
pub enum ForkError {
    #[error(transparent)]
    Lifecycle(#[from] LifecycleError),
    #[error(transparent)]
    Config(#[from] ConfigError),
}

impl HttpStatus for ForkError {
    fn status_kind(&self) -> StatusKind {
        match self {
            Self::Lifecycle(err) => err.status_kind(),
            Self::Config(err) => err.status_kind(),
        }
    }
}

/// Error surfaced by `discard_chat`.
#[derive(Debug, thiserror::Error)]
pub enum DiscardError {
    #[error(transparent)]
    NotFound(#[from] NotFound),
    /// The scratch directory could not be removed, so the row was kept and a
    /// retry stays possible.
    #[error(transparent)]
    ScratchDir(#[from] SeamError),
}

impl HttpStatus for DiscardError {
    fn status_kind(&self) -> StatusKind {
        match self {
            Self::NotFound(_) => StatusKind::NotFound,
            Self::ScratchDir(_) => StatusKind::Internal,
        }
    }
}

/// Error surfaced by `remove_project`.
#[derive(Debug, thiserror::Error)]
pub enum RemoveProjectError {
    /// Removing the hidden scratch project would cascade-delete every
    /// non-project chat's row.
    #[error("cannot remove the hidden scratch project")]
    ScratchProject,
    #[error(transparent)]
    Store(#[from] SeamError),
}

impl HttpStatus for RemoveProjectError {
    fn status_kind(&self) -> StatusKind {
        match self {
            Self::ScratchProject => StatusKind::BadRequest,
            Self::Store(_) => StatusKind::Internal,
        }
    }
}
