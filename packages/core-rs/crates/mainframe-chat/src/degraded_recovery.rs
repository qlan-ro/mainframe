//! Degraded-chat recovery actions (missing transcript / missing worktree).
//!
//! Backs the daemon recovery routes and the degraded-chat UI card:
//! - `continue_here` — forget the dead CLI session so the next send spawns fresh
//!   in the same chat row (title/branch/worktree/project metadata carry over).
//! - `continue_in_project_root` — detach a chat from its deleted worktree and
//!   rebind it to the main checkout.
//! - `recreate_chat_worktree` — re-add the worktree at its stored path from the
//!   stored branch; fails clearly (409) when the branch is gone.

use crate::chat_manager::ChatShared;
use crate::event_handler::EventHandler;
use mainframe_types::chat::Chat;
use mainframe_types::events::DaemonEvent;
use mainframe_types::http_status::{HttpStatus, StatusKind};
use mainframe_types::sync::LockExt as _;

/// Errors surfaced by the recovery ops. The strings cross the wire (the routes
/// return them verbatim).
#[derive(Debug, thiserror::Error)]
pub enum DegradedRecoveryError {
    #[error(transparent)]
    Store(#[from] mainframe_types::seam_error::SeamError),
    #[error("Chat {0} not found")]
    ChatNotFound(String),
    #[error("Chat has no worktree")]
    NoWorktree,
    #[error("Chat has no worktree to recreate")]
    NoWorktreeToRecreate,
    #[error("Project {0} not found")]
    ProjectNotFound(String),
    #[error("Branch \"{0}\" no longer exists — continue in the project root instead")]
    BranchGone(String),
}

impl HttpStatus for DegradedRecoveryError {
    /// A missing chat or project is a 404 and a vanished branch a 409; a
    /// chat with no worktree to act on is a bad request.
    fn status_kind(&self) -> StatusKind {
        match self {
            Self::Store(_) => StatusKind::Internal,
            Self::ChatNotFound(_) | Self::ProjectNotFound(_) => StatusKind::NotFound,
            Self::BranchGone(_) => StatusKind::Conflict,
            Self::NoWorktree | Self::NoWorktreeToRecreate => StatusKind::BadRequest,
        }
    }
}

fn require_chat(shared: &ChatShared, chat_id: &str) -> Result<Chat, DegradedRecoveryError> {
    shared
        .deps
        .chats_get(chat_id)?
        .ok_or_else(|| DegradedRecoveryError::ChatNotFound(chat_id.to_string()))
}

/// Kill a spawned CLI session so the next send respawns with the recovered config.
async fn kill_spawned_session(shared: &ChatShared, chat_id: &str) {
    if let Some(session) = shared
        .active(chat_id)
        .and_then(|cell| cell.lock_recover().session.clone())
        && session.is_spawned()
    {
        if let Err(error) = session.kill().await {
            tracing::warn!(%error, chat_id, "recovery could not stop the session");
        }
        if let Some(cell) = shared.active(chat_id) {
            cell.lock_recover().session = None;
        }
    }
}

pub(crate) async fn continue_here(
    shared: &ChatShared,
    event_handler: &EventHandler,
    chat_id: &str,
) -> Result<(), DegradedRecoveryError> {
    require_chat(shared, chat_id)?;
    kill_spawned_session(shared, chat_id).await;
    shared.deps.chats_clear_session(chat_id)?;
    if let Some(cell) = shared.active(chat_id) {
        let mut active = cell.lock_recover();
        active.chat.claude_session_id = None;
        active.chat.session_file_path = None;
        active.chat.transcript_missing = Some(false);
    }
    shared.messages.lock_recover().delete(chat_id);
    event_handler.clear_display_state(chat_id);
    emit_updated(shared, chat_id);
    Ok(())
}

pub(crate) async fn continue_in_project_root(
    shared: &ChatShared,
    chat_id: &str,
) -> Result<(), DegradedRecoveryError> {
    let chat = require_chat(shared, chat_id)?;
    if chat.worktree_path.is_none() {
        return Err(DegradedRecoveryError::NoWorktree);
    }
    kill_spawned_session(shared, chat_id).await;
    shared.deps.chats_clear_worktree(chat_id)?;
    if let Some(cell) = shared.active(chat_id) {
        let mut active = cell.lock_recover();
        active.chat.worktree_path = None;
        active.chat.branch_name = None;
    }
    emit_updated(shared, chat_id);
    Ok(())
}

pub(crate) async fn recreate_chat_worktree(
    shared: &ChatShared,
    chat_id: &str,
) -> Result<(), DegradedRecoveryError> {
    let chat = require_chat(shared, chat_id)?;
    let (Some(worktree_path), Some(branch_name)) =
        (chat.worktree_path.clone(), chat.branch_name.clone())
    else {
        return Err(DegradedRecoveryError::NoWorktreeToRecreate);
    };
    let project_path = shared
        .deps
        .projects_get_path(&chat.project_id)
        .ok_or_else(|| DegradedRecoveryError::ProjectNotFound(chat.project_id.clone()))?;

    if !shared.deps.branch_exists(&project_path, &branch_name).await {
        return Err(DegradedRecoveryError::BranchGone(branch_name));
    }
    shared
        .deps
        .add_worktree(&project_path, &worktree_path, &branch_name)
        .await;
    // enrichChat recomputes worktreeMissing from disk on read, so a plain re-emit clears the flag.
    emit_updated(shared, chat_id);
    Ok(())
}

fn emit_updated(shared: &ChatShared, chat_id: &str) {
    if let Some(chat) = shared.chat_or_db(chat_id) {
        shared.emit(DaemonEvent::ChatUpdated { chat, reason: None });
    }
}

#[cfg(test)]
mod tests;
