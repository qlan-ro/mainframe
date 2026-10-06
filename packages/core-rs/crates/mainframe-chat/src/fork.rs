//! Pure helpers for todo #343's fork feature — the pieces `ChatManager::fork_chat`
//! (`chat_manager/fork_api.rs`) needs that don't touch the registry, the DB or an
//! adapter: the fork point, the provisional title rule, the deps-boundary data shapes (so
//! `mainframe-chat` never depends on `mainframe-db`'s `PendingFork`/`ForkInsert`),
//! and the REST-status mapping for `ForkChatError`.
//!
//! See `docs/plans/2026-09-24-todo-343-fork-thread.md` "Group 3 — daemon-fork".

use mainframe_types::adapter::{EffortLevel, ForkSource};
use mainframe_types::settings::ExecutionMode;

/// Where `ChatManager::fork_chat` cuts the parent's conversation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ForkPoint {
    /// The parent's current end (todo #343's whole-chat fork).
    Current,
    /// Immediately before this chat message id, which must name a sent user
    /// message. The fork holds everything before it and nothing after.
    BeforeMessage(String),
}

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
/// display name (for the 422 message), whether it can fork at all, and — when
/// it can't — a version-specific reason (todo #368, e.g. an old Codex CLI)
/// preferred over the generic "isn't available" message.
#[derive(Debug, Clone, PartialEq)]
pub struct AdapterForkInfo {
    pub name: String,
    pub fork: bool,
    pub unavailable_reason: Option<String>,
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
    /// A multi-segment parent's segments, as the fork copies them. `None`
    /// gives the fork one initial segment.
    pub segments: Option<mainframe_types::segment::ForkPlan>,
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
    /// `adapter_fork_info` reported a version-specific reason (todo #368,
    /// e.g. "Forking Codex chats needs Codex CLI 0.143.0 or newer") instead
    /// of a bare capability flag. Preferred over `Unsupported` whenever a
    /// reason exists, so the 422 body names the fix instead of just the gap.
    #[error("{0}")]
    UnavailableWithReason(String),
    #[error("Temporary chats can't be forked")]
    Temporary,
    #[error("Chats with no project can't be forked")]
    NoProject,
    #[error("Nothing to fork yet")]
    NothingToForkYet,
    #[error("This chat's transcript is missing")]
    TranscriptMissing,
    #[error("This chat's folder is missing")]
    DirectoryMissing,
    #[error("Wait for the current turn to finish or interrupt it")]
    TurnInFlight,
    #[error("Message not found")]
    MessageNotFound,
    #[error("fromMessageId must name a user message")]
    NotAUserMessage,
    #[error("This message hasn't been sent yet")]
    MessageNotSent,
    #[error("Nothing before this message to fork")]
    NothingBeforeMessage,
    /// The message lies before the chat's latest provider switch, or opens
    /// the segment that switch started (it carries the handoff). Names the
    /// provider switched to.
    #[error("Can't fork from before the switch to {0}")]
    BeforeProviderSwitch(String),
    /// The same rule for a segment a context reset (`/clear`, plan "clear
    /// context") started: the earlier session is no longer the chat's.
    #[error("Can't fork from before this chat's context was cleared")]
    BeforeContextReset,
    /// The message can't be placed in the provider transcript. The reason
    /// names why ("Couldn't find this message…", "…joined a turn…").
    #[error("{0}")]
    ForkPointUnresolved(String),
    #[error("{0}")]
    PinFailed(String),
    #[error("{0}")]
    InsertFailed(String),
}

impl ForkChatError {
    /// The REST status the Daemon contract table assigns this failure.
    pub fn status_code(&self) -> u16 {
        match self {
            ForkChatError::NotFound(_) | ForkChatError::MessageNotFound => 404,
            ForkChatError::NotAUserMessage => 400,
            ForkChatError::Unsupported(_) | ForkChatError::UnavailableWithReason(_) => 422,
            ForkChatError::Temporary
            | ForkChatError::NoProject
            | ForkChatError::NothingToForkYet
            | ForkChatError::TranscriptMissing
            | ForkChatError::DirectoryMissing
            | ForkChatError::TurnInFlight
            | ForkChatError::MessageNotSent
            | ForkChatError::NothingBeforeMessage
            | ForkChatError::BeforeProviderSwitch(_)
            | ForkChatError::BeforeContextReset
            | ForkChatError::ForkPointUnresolved(_) => 409,
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
        assert_eq!(
            ForkChatError::UnavailableWithReason("needs a newer CLI".into()).status_code(),
            422
        );
        assert_eq!(ForkChatError::NothingToForkYet.status_code(), 409);
        assert_eq!(ForkChatError::TranscriptMissing.status_code(), 409);
        assert_eq!(ForkChatError::DirectoryMissing.status_code(), 409);
        assert_eq!(ForkChatError::TurnInFlight.status_code(), 409);
        assert_eq!(ForkChatError::MessageNotFound.status_code(), 404);
        assert_eq!(ForkChatError::NotAUserMessage.status_code(), 400);
        assert_eq!(ForkChatError::MessageNotSent.status_code(), 409);
        assert_eq!(ForkChatError::NothingBeforeMessage.status_code(), 409);
        assert_eq!(
            ForkChatError::BeforeProviderSwitch("Codex".into()).status_code(),
            409
        );
        assert_eq!(ForkChatError::BeforeContextReset.status_code(), 409);
        assert_eq!(
            ForkChatError::ForkPointUnresolved("gone".into()).status_code(),
            409
        );
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
        assert_eq!(
            ForkChatError::BeforeProviderSwitch("Codex".into()).to_string(),
            "Can't fork from before the switch to Codex"
        );
        assert_eq!(
            ForkChatError::UnavailableWithReason(
                "Forking Codex chats needs Codex CLI 0.143.0 or newer (installed: 0.140.0)".into()
            )
            .to_string(),
            "Forking Codex chats needs Codex CLI 0.143.0 or newer (installed: 0.140.0)"
        );
    }
}

// PORT STATUS: new (todo #343 Group 3)
// confidence: high
// todos: 0
