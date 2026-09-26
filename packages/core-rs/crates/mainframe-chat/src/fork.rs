//! Pure helpers for todo #343's fork feature — the pieces `ChatManager::fork_chat`
//! (`chat_manager/fork_api.rs`) needs that don't touch the registry, the DB or an
//! adapter: the provisional title rule, the deps-boundary data shapes (so
//! `mainframe-chat` never depends on `mainframe-db`'s `PendingFork`/`ForkInsert`),
//! and the REST-status mapping for `ForkChatError`.
//!
//! See `docs/plans/2026-09-24-todo-343-fork-thread.md` "Group 3 — daemon-fork".

use mainframe_types::adapter::{EffortLevel, ForkSource};
use mainframe_types::settings::ExecutionMode;

/// `chats.pending_fork`'s in-memory shape, as it crosses the `ChatManagerDeps` /
/// `LifecycleManagerDeps` / `EventHandlerDeps` boundary. Mirrors
/// `mainframe_db::chats::PendingFork` field-for-field; kept as a separate type
/// because this crate does not depend on `mainframe-db` (the daemon-side deps
/// impl translates both ways).
#[derive(Debug, Clone, PartialEq)]
pub struct PendingForkState {
    pub fork_source: ForkSource,
    pub snapshot_dir: String,
    pub provisional_title: String,
}

/// What `fork_chat`'s capability check needs from the parent's adapter: its
/// display name (for the 422 message) and whether it can fork at all.
#[derive(Debug, Clone, PartialEq)]
pub struct AdapterForkInfo {
    pub name: String,
    pub fork: bool,
}

/// Inputs to the DB's `create_fork`, gathered from the enriched parent chat by
/// `ChatManager::fork_chat`. A same-shaped mirror of `mainframe_db::chats::ForkInsert`
/// (owned, not borrowed — it crosses the deps trait boundary).
#[derive(Debug, Clone)]
pub struct ForkCreateInput {
    pub parent_chat_id: String,
    pub project_id: String,
    pub adapter_id: String,
    pub model: Option<String>,
    pub permission_mode: Option<ExecutionMode>,
    pub plan_mode: bool,
    pub effort: Option<EffortLevel>,
    pub fast: Option<bool>,
    pub ultracode: Option<bool>,
    pub adaptive_thinking: Option<bool>,
    pub worktree_path: Option<String>,
    pub branch_name: Option<String>,
    pub title: Option<String>,
    pub pending_fork: PendingForkState,
}

/// The fork's provisional title: `<parent title> (fork)`, without stacking a
/// second marker on a parent whose own title already ends in it, and
/// `Untitled (fork)` for an untitled parent. The spec deliberately never
/// stacks the marker — it becomes unreadable after a few levels, and the
/// lineage UI already shows fork depth.
pub fn fork_title(parent_title: Option<&str>) -> String {
    const MARKER: &str = " (fork)";
    match parent_title.map(str::trim).filter(|t| !t.is_empty()) {
        None => format!("Untitled{MARKER}"),
        Some(title) if title.ends_with(MARKER) => title.to_string(),
        Some(title) => format!("{title}{MARKER}"),
    }
}

/// Errors `ChatManager::fork_chat` surfaces, mapped 1:1 to the Daemon contract
/// table in the spec. Message text matches the Behavior list's disabled-reason
/// copy so a 409/422 body can be shown to the user verbatim.
#[derive(Debug, Clone, PartialEq, thiserror::Error)]
pub enum ForkChatError {
    #[error("Chat {0} not found")]
    NotFound(String),
    #[error("Forking isn't available for {0} chats yet")]
    Unsupported(String),
    #[error("Nothing to fork yet")]
    NothingToForkYet,
    #[error("This chat's transcript is missing")]
    TranscriptMissing,
    #[error("This chat's folder is missing")]
    DirectoryMissing,
    #[error("Wait for the current turn to finish or interrupt it")]
    TurnInFlight,
    #[error("{0}")]
    PinFailed(String),
    #[error("{0}")]
    InsertFailed(String),
}

impl ForkChatError {
    /// The REST status the Daemon contract table assigns this failure.
    pub fn status_code(&self) -> u16 {
        match self {
            ForkChatError::NotFound(_) => 404,
            ForkChatError::Unsupported(_) => 422,
            ForkChatError::NothingToForkYet
            | ForkChatError::TranscriptMissing
            | ForkChatError::DirectoryMissing
            | ForkChatError::TurnInFlight => 409,
            ForkChatError::PinFailed(_) | ForkChatError::InsertFailed(_) => 500,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn untitled_parent_yields_untitled_fork() {
        assert_eq!(fork_title(None), "Untitled (fork)");
        assert_eq!(fork_title(Some("")), "Untitled (fork)");
        assert_eq!(fork_title(Some("   ")), "Untitled (fork)");
    }

    #[test]
    fn titled_parent_appends_the_marker_once() {
        assert_eq!(
            fork_title(Some("Fix the flaky test")),
            "Fix the flaky test (fork)"
        );
    }

    #[test]
    fn a_parent_already_marked_as_a_fork_is_not_stacked() {
        assert_eq!(
            fork_title(Some("Fix the flaky test (fork)")),
            "Fix the flaky test (fork)"
        );
    }

    #[test]
    fn status_codes_match_the_daemon_contract_table() {
        assert_eq!(ForkChatError::NotFound("c1".into()).status_code(), 404);
        assert_eq!(
            ForkChatError::Unsupported("Codex".into()).status_code(),
            422
        );
        assert_eq!(ForkChatError::NothingToForkYet.status_code(), 409);
        assert_eq!(ForkChatError::TranscriptMissing.status_code(), 409);
        assert_eq!(ForkChatError::DirectoryMissing.status_code(), 409);
        assert_eq!(ForkChatError::TurnInFlight.status_code(), 409);
        assert_eq!(ForkChatError::PinFailed("boom".into()).status_code(), 500);
        assert_eq!(
            ForkChatError::InsertFailed("boom".into()).status_code(),
            500
        );
    }

    #[test]
    fn messages_name_the_reason_for_the_ui_toast() {
        assert_eq!(
            ForkChatError::Unsupported("Codex".into()).to_string(),
            "Forking isn't available for Codex chats yet"
        );
        assert_eq!(
            ForkChatError::NothingToForkYet.to_string(),
            "Nothing to fork yet"
        );
    }
}

// PORT STATUS: new (todo #343 Group 3)
// confidence: high
// todos: 0
