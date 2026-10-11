#![allow(clippy::unwrap_used, clippy::expect_used)]

//! Golden texts and status classes for the chat errors REST routes and the
//! chat's error banner show verbatim. Each pair is wire contract.

use mainframe_adapter_api::AdapterError;
use mainframe_chat::chat_manager::{
    DiscardError, RemoveProjectError, SendError, TrustWorkspaceError,
};
use mainframe_chat::config_manager::ConfigError;
use mainframe_chat::degraded_recovery::DegradedRecoveryError;
use mainframe_chat::lifecycle_manager::LifecycleError;
use mainframe_chat::permission_handler::PermissionError;
use mainframe_chat::worktree_offer::OfferError;
use mainframe_services::workspace::session_files::SessionFilesError;
use mainframe_types::http_status::{HttpStatus, NotFound, StatusKind};
use mainframe_types::seam_error::SeamError;

fn wire(err: &(impl HttpStatus + std::fmt::Display)) -> (StatusKind, String) {
    (err.status_kind(), err.to_string())
}

fn pair(kind: StatusKind, text: &str) -> (StatusKind, String) {
    (kind, text.to_string())
}

#[test]
fn lifecycle_errors() {
    use LifecycleError as E;
    let not_found = |e: NotFound| E::NotFound(e);
    assert_eq!(
        wire(&not_found(NotFound::new("Chat", "c1"))),
        pair(StatusKind::NotFound, "Chat c1 not found")
    );
    assert_eq!(
        wire(&not_found(NotFound::unnamed("Project"))),
        pair(StatusKind::NotFound, "Project not found")
    );
    assert_eq!(
        wire(&not_found(NotFound::new("Adapter", "codex"))),
        pair(StatusKind::NotFound, "Adapter codex not found")
    );
    assert_eq!(
        wire(&E::NotLoaded("c1".into())),
        pair(StatusKind::Internal, "Chat c1 not found after load")
    );
    assert_eq!(
        wire(&E::WorktreeMissing("/w".into())),
        pair(
            StatusKind::Conflict,
            "Worktree directory does not exist: /w"
        )
    );
    assert_eq!(
        wire(&E::ProjectDirMissing("/p".into())),
        pair(
            StatusKind::Conflict,
            "Project directory does not exist or is not accessible: /p"
        )
    );
    assert_eq!(
        wire(&E::DirtyWorkingTree),
        pair(
            StatusKind::Conflict,
            "Commit or stash your changes before forking"
        )
    );
}

#[test]
fn config_errors() {
    assert_eq!(
        wire(&ConfigError::from(NotFound::new("Chat", "c1"))),
        pair(StatusKind::NotFound, "Chat c1 not found")
    );
    assert_eq!(
        wire(&ConfigError::Refused(
            "Cannot disable worktree after session has started".into()
        )),
        pair(
            StatusKind::BadRequest,
            "Cannot disable worktree after session has started"
        )
    );
    assert_eq!(
        wire(&ConfigError::ChatBusy),
        pair(
            StatusKind::Conflict,
            "Finish or stop the current response before switching worktrees"
        )
    );
    let moved = SessionFilesError::Io(std::io::Error::other("disk full"));
    assert_eq!(
        wire(&ConfigError::TranscriptMoveFailed(moved)),
        pair(
            StatusKind::Internal,
            "Moving the session's history into the worktree failed. The session stayed where it was."
        )
    );
    assert_eq!(
        wire(&ConfigError::Adapter(AdapterError::NotSpawned("s1".into()))),
        pair(StatusKind::Internal, "Session s1 not spawned")
    );
}

#[test]
fn offer_errors() {
    assert_eq!(
        wire(&OfferError::NotPending),
        pair(
            StatusKind::BadRequest,
            "No pending worktree offer for that path"
        )
    );
    assert_eq!(
        wire(&OfferError::Vanished),
        pair(StatusKind::BadRequest, "Worktree no longer exists")
    );
    assert_eq!(
        wire(&OfferError::SwitchInProgress),
        pair(
            StatusKind::Conflict,
            "A worktree switch is already in progress"
        )
    );
    assert_eq!(
        wire(&OfferError::from(ConfigError::from(NotFound::new(
            "Chat", "c1"
        )))),
        pair(StatusKind::NotFound, "Chat c1 not found")
    );
}

#[test]
fn recovery_errors() {
    use DegradedRecoveryError as E;
    assert_eq!(
        wire(&E::ChatNotFound("c1".into())),
        pair(StatusKind::NotFound, "Chat c1 not found")
    );
    assert_eq!(
        wire(&E::ProjectNotFound("p1".into())),
        pair(StatusKind::NotFound, "Project p1 not found")
    );
    assert_eq!(
        wire(&E::NoWorktree),
        pair(StatusKind::BadRequest, "Chat has no worktree")
    );
    assert_eq!(
        wire(&E::BranchGone("feat".into())),
        pair(
            StatusKind::Conflict,
            "Branch \"feat\" no longer exists — continue in the project root instead"
        )
    );
}

#[test]
fn manager_errors() {
    assert_eq!(
        wire(&DiscardError::from(NotFound::unnamed("Chat"))),
        pair(StatusKind::NotFound, "Chat not found")
    );
    assert_eq!(
        wire(&RemoveProjectError::ScratchProject),
        pair(
            StatusKind::BadRequest,
            "cannot remove the hidden scratch project"
        )
    );
    assert_eq!(
        wire(&TrustWorkspaceError::Write(SeamError::msg("EACCES"))),
        pair(StatusKind::Internal, "EACCES")
    );
    assert_eq!(
        wire(&TrustWorkspaceError::ProjectNotFound("p1".into())),
        pair(StatusKind::NotFound, "Project p1 not found")
    );
}

#[test]
fn send_and_permission_texts() {
    let cases = [
        (SendError::NotRunning("c1".into()), "Chat c1 not running"),
        (
            SendError::SteerUnsupported("c1".into()),
            "Chat c1's adapter cannot steer a running turn",
        ),
        (
            SendError::NoActiveTurn("c1".into()),
            "Chat c1 has no active turn",
        ),
        (
            SendError::HandoffTooLarge("Codex".into()),
            "This message is too large to send with Codex's context handoff. Shorten it or remove attachments.",
        ),
    ];
    for (err, text) in cases {
        assert_eq!(err.to_string(), text);
    }
    assert_eq!(
        PermissionError::NoSession("c1".into()).to_string(),
        "No session for chat c1"
    );
    assert_eq!(
        PermissionError::ManagerUnavailable.to_string(),
        "chat manager unavailable"
    );
}
