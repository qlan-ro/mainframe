//! Pure helpers for the fork-a-chat feature — the pieces `ChatManager::fork_chat`
//! (`chat_manager/fork_api.rs`) needs that don't touch the registry, the DB or an
//! adapter: the fork point, provisional title, and REST-status class of `ForkChatError`.

use mainframe_types::http_status::{HttpStatus, StatusKind};
use mainframe_types::seam_error::SeamError;

/// Where `ChatManager::fork_chat` cuts the parent's conversation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ForkPoint {
    /// The parent's current end (a whole-chat fork).
    Current,
    /// Immediately before this chat message id, which must name a sent user
    /// message. The fork holds everything before it and nothing after.
    BeforeMessage(String),
}

pub use mainframe_db::chats::PendingFork as PendingForkState;

/// What `fork_chat`'s capability check needs from the parent's adapter: its
/// display name (for the 422 message), whether it can fork at all, and — when
/// it can't — a version-specific reason (e.g. an old Codex CLI) preferred over
/// the generic "isn't available" message.
#[derive(Debug, Clone, PartialEq)]
pub struct AdapterForkInfo {
    pub name: String,
    pub fork: bool,
    pub unavailable_reason: Option<String>,
}

pub use mainframe_db::chats::ForkCreateInput;

/// The fork's provisional title: `<parent title> (fork)`, without stacking a
/// second marker on a parent whose own title already ends in it, and
/// `Untitled (fork)` for an untitled parent. The spec deliberately never
/// stacks the marker — it becomes unreadable after a few levels, and the
/// lineage UI already shows fork depth.
pub(crate) fn fork_title(parent_title: Option<&str>) -> String {
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
    /// `adapter_fork_info` reported a version-specific reason (e.g. "Forking
    /// Codex chats needs Codex CLI 0.143.0 or newer") instead of a bare
    /// capability flag. Preferred over `Unsupported` whenever a reason exists,
    /// so the 422 body names the fix instead of just the gap.
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
    #[error(transparent)]
    InsertFailed(SeamError),
}

impl HttpStatus for ForkChatError {
    /// The REST status the Daemon contract table assigns this failure.
    fn status_kind(&self) -> StatusKind {
        match self {
            ForkChatError::NotFound(_) | ForkChatError::MessageNotFound => StatusKind::NotFound,
            ForkChatError::NotAUserMessage => StatusKind::BadRequest,
            ForkChatError::Unsupported(_) | ForkChatError::UnavailableWithReason(_) => {
                StatusKind::Unprocessable
            }
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
            | ForkChatError::ForkPointUnresolved(_) => StatusKind::Conflict,
            ForkChatError::PinFailed(_) | ForkChatError::InsertFailed(_) => StatusKind::Internal,
        }
    }
}

#[cfg(test)]
#[path = "fork_tests.rs"]
mod tests;
