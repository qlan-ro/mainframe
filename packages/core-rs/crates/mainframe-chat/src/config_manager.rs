use mainframe_types::sync::LockExt as _;
use std::sync::{Arc, Mutex};

use mainframe_adapter_api::{AdapterError, AdapterSession, BoxFuture};
use mainframe_services::settings::read_setting;
use mainframe_services::workspace::session_files::SessionFilesError;
use mainframe_services::workspace::worktree::WorktreeError;
use mainframe_services::workspace::{create_worktree, move_session_files, remove_worktree};
use mainframe_types::adapter::model_endpoint;
use mainframe_types::chat::Project;
use mainframe_types::chat_patch::ChatPatch;
use mainframe_types::events::DaemonEvent;
use mainframe_types::http_status::{HttpStatus, NotFound, StatusKind};
use mainframe_types::settings::{ExecutionMode, GeneralConfig};
use mainframe_types::settings_kv::SettingsKv;
use tracing::warn;

use crate::config_respawn_guard::{model_changed, respawn_refusal};
use crate::config_transcripts::{ActiveSession, OwnedNativeSession, relocate_claude_transcripts};
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

/// Injected dependency surface for [`ChatConfigManager`].
///
/// `get_active_chat` returns the shared per-chat cell (`Arc<Mutex<ActiveChat>>`);
/// the manager mutates `active.chat` in place under a short lock and never holds
/// it across `.await`. Database and adapter access collapse into the narrow
/// methods actually used (no not-Send `mainframe-db` repo here).
pub trait ConfigManagerDeps: Send + Sync {
    fn get_active_chat(&self, chat_id: &str) -> Option<Arc<Mutex<ActiveChat>>>;
    fn chats_update(&self, chat_id: &str, updates: &ChatPatch);
    fn projects_get(&self, project_id: &str) -> Option<Project>;
    /// The settings store (the configured worktree directory).
    fn settings(&self) -> &dyn SettingsKv;
    fn emit_event(&self, event: DaemonEvent);
    fn start_chat<'a>(&'a self, chat_id: &'a str) -> BoxFuture<'a, ()>;
    fn stop_chat<'a>(&'a self, chat_id: &'a str) -> BoxFuture<'a, ()>;
    /// Re-resolve tuning against the (possibly new) model and apply to the live session.
    fn apply_tuning<'a>(&'a self, chat_id: &'a str) -> BoxFuture<'a, ()>;
    /// Stop launch processes for a project+path pair (`stopLaunchProcesses?`).
    fn stop_launch_processes<'a>(
        &'a self,
        project_id: &'a str,
        project_path: &'a str,
    ) -> Option<BoxFuture<'a, ()>>;
    /// The in-flight spawn single-flight guard (`startingChats.get(chatId)`).
    fn take_starting_chat<'a>(&'a self, chat_id: &'a str) -> Option<BoxFuture<'a, ()>>;
    /// Fired after a binding change persists — the offer registry's single
    /// source of `resolved{accepted}`.
    fn on_binding_changed(&self, _chat_id: &str, _worktree_path: Option<&str>) {}
    /// Whether any owned native session of the chat has a provider id — after
    /// that, an adapter change is a provider switch, not a config edit.
    /// `false` (the default) for a deps impl that stores no segments; the
    /// mirrored `claude_session_id` check still applies.
    fn has_native_session(&self, _chat_id: &str) -> bool {
        false
    }
    /// Live background tasks (shells, agents) the CLI owns: a respawn would
    /// end them. `0` (the default) for a deps impl with no task tracker.
    fn live_background_tasks(&self, _chat_id: &str) -> usize {
        0
    }
    /// An adapter's display name, for refusal copy.
    fn adapter_name(&self, adapter_id: &str) -> String {
        adapter_id.to_string()
    }
    /// The chat's owned native sessions that have a provider id, which a
    /// worktree move relocates. Empty (the default) for a deps impl that
    /// stores no segments: the mirrored active session moves as before.
    fn owned_native_sessions(&self, _chat_id: &str) -> Vec<OwnedNativeSession> {
        Vec::new()
    }
    /// Records a relocated transcript path on one native row.
    fn set_native_session_file_path(&self, _native_ref: &str, _path: &str) {}
    /// Relocate a Claude session's transcript files between project dirs. A seam
    /// only so tests can exercise the failure path without touching a real `$HOME`.
    fn move_claude_session_files<'a>(
        &'a self,
        session_id: &'a str,
        old_dir: &'a str,
        new_dir: &'a str,
    ) -> BoxFuture<'a, Result<(), SessionFilesError>> {
        Box::pin(move_session_files(session_id, old_dir, new_dir))
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

pub struct ChatConfigManager<D: ConfigManagerDeps> {
    deps: D,
    changes: KeyedMutex,
}

mod enable;
mod live;
mod rebind;
mod update;
mod worktree;

#[cfg(test)]
mod tests;
