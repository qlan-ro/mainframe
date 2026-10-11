use mainframe_types::sync::LockExt as _;
use std::sync::{Arc, Mutex};

use mainframe_adapter_api::{AdapterError, AdapterSession};
use mainframe_services::settings::read_setting;
use mainframe_services::workspace::session_files::SessionFilesError;
use mainframe_services::workspace::worktree::WorktreeError;
use mainframe_services::workspace::{create_worktree, remove_worktree};
use mainframe_types::adapter::model_endpoint;
use mainframe_types::chat_patch::ChatPatch;
use mainframe_types::events::DaemonEvent;
use mainframe_types::http_status::{HttpStatus, NotFound, StatusKind};
use mainframe_types::settings::{ExecutionMode, GeneralConfig};
use tracing::warn;

use crate::config_respawn_guard::{model_changed, respawn_refusal};
use crate::config_transcripts::{ActiveSession, relocate_claude_transcripts};
use crate::types::ActiveChat;

/// User-facing message when a chat's transcripts could not be moved into its
/// worktree; the chat keeps running on its previous binding.
const TRANSCRIPT_MOVE_FAILED: &str = "Moving the session's history into the worktree failed. The chat kept its previous binding; some history files may have moved.";

use mainframe_runtime::sync::KeyedMutex;

/// Errors surfaced by config changes. The message strings cross the wire:
/// routes return them as the error text.
#[derive(Debug, thiserror::Error)]
pub enum ConfigError {
    #[error(transparent)]
    NotFound(#[from] NotFound),
    /// The chat's state refuses the change; the text says why and what to do
    /// instead.
    #[error("{0}")]
    Refused(String),
    /// Rebinding stops and restarts the CLI, which would cut a turn off mid-answer.
    #[error("Finish or stop the current response before switching worktrees")]
    ChatBusy,
    /// `git worktree add` failed (a taken branch name, a bad base).
    #[error(transparent)]
    Worktree(#[from] WorktreeError),
    /// The chat's transcripts could not follow it into the worktree; the chat
    /// keeps running on its previous binding.
    #[error("{TRANSCRIPT_MOVE_FAILED}")]
    TranscriptMoveFailed(#[source] SessionFilesError),
    #[error(
        "The worktree was created at {worktree_path}, but moving the session's history failed. The chat kept its previous binding; some history files may have moved."
    )]
    WorktreeCreated {
        worktree_path: String,
        #[source]
        source: SessionFilesError,
    },
    #[error(transparent)]
    Adapter(#[from] AdapterError),
}

impl HttpStatus for ConfigError {
    fn status_kind(&self) -> StatusKind {
        match self {
            Self::NotFound(_) => StatusKind::NotFound,
            Self::Refused(_) | Self::Worktree(WorktreeError::Git(_)) => StatusKind::BadRequest,
            Self::ChatBusy => StatusKind::Conflict,
            Self::Worktree(WorktreeError::Io(_))
            | Self::TranscriptMoveFailed(_)
            | Self::WorktreeCreated { .. }
            | Self::Adapter(_) => StatusKind::Internal,
        }
    }
}

/// The chat's current effective directory: its worktree when bound, else the project root.
fn effective_dir<'a>(current_worktree: Option<&'a str>, project_path: &'a str) -> &'a str {
    current_worktree.unwrap_or(project_path)
}

struct LiveChanges {
    model: Option<String>,
    permission_mode: Option<ExecutionMode>,
    plan_mode: Option<bool>,
}

/// A live chat's move onto a worktree, for `rebind_live_session`.
struct LiveRebind<'a> {
    project_id: &'a str,
    /// The directory the chat's transcripts are keyed by now.
    old_dir: &'a str,
    /// The worktree the chat is bound to now, whose launch processes stop.
    old_worktree: Option<&'a str>,
    active: ActiveSession<'a>,
    worktree_path: String,
    branch_name: Option<String>,
}

struct RespawnChanges {
    adapter_id: Option<String>,
    model: Option<String>,
    permission_mode: Option<ExecutionMode>,
    plan_mode: Option<bool>,
}

pub struct ChatConfigManager {
    shared: Arc<crate::chat_manager::ChatShared>,
    lifecycle: Arc<crate::lifecycle_manager::ChatLifecycleManager>,
    worktree_offers: Arc<crate::worktree_offer::WorktreeOfferRegistry>,
    changes: KeyedMutex,
}

mod enable;
mod live;
mod rebind;
mod update;
mod worktree;

#[cfg(test)]
mod tests;
