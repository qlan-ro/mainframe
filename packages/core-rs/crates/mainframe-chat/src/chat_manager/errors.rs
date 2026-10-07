//! Command metadata plus the error/parameter types `send_message` and its
//! sibling delegations surface across the wire.
use super::*;

/// `metadata.command` for `sendMessage` (`{ name, source, args? }`).
#[derive(Debug, Clone)]
pub struct CommandMeta {
    pub name: String,
    pub source: String,
    pub args: Option<String>,
}

/// Error surfaced by `sendMessage`/queue ops (message crosses the wire).
#[derive(Debug, thiserror::Error)]
#[error("{0}")]
pub struct SendError(pub String);

impl From<AdapterError> for SendError {
    fn from(e: AdapterError) -> Self {
        SendError(e.to_string())
    }
}

/// Error surfaced by `trust_workspace` (message crosses the wire as a 500 body,
/// mirroring the TS `catch (err) { fail(res, 500, err.message) }`).
#[derive(Debug, thiserror::Error)]
pub enum TrustWorkspaceError {
    #[error("Chat {0} not found")]
    ChatNotFound(String),
    #[error("Project {0} not found")]
    ProjectNotFound(String),
    #[error("{0}")]
    Write(String),
}

/// Present-only partial for `sync_chat_fields` (mirrors the `Partial<Chat>` the
/// tuning/pinned PATCH routes write). Tri-state fields (`Some(None)` = explicit
/// null) match the DB tuning columns; `pinned` is a plain bool.
#[derive(Debug, Clone, Default)]
pub struct ChatFieldsPartial {
    pub effort: Option<Option<EffortLevel>>,
    pub fast: Option<Option<bool>>,
    pub ultracode: Option<Option<bool>>,
    pub adaptive_thinking: Option<Option<bool>>,
    pub pinned: Option<bool>,
}

/// Error surfaced by `forkToWorktree` (the create step is fallible, the enable step
/// too). `status_code()` mirrors the TS `err.statusCode ?? 500` (dirty tree → 409).
#[derive(Debug, thiserror::Error)]
pub enum ForkError {
    #[error(transparent)]
    Lifecycle(#[from] LifecycleError),
    #[error(transparent)]
    Config(#[from] ConfigError),
}

impl ForkError {
    pub fn status_code(&self) -> u16 {
        match self {
            ForkError::Lifecycle(LifecycleError::DirtyWorkingTree) => 409,
            _ => 500,
        }
    }
}
