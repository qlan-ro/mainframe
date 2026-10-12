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
    assert_eq!(
        ForkChatError::NotFound("c1".into()).status_kind(),
        StatusKind::NotFound
    );
    assert_eq!(
        ForkChatError::Unsupported("Codex".into()).status_kind(),
        StatusKind::Unprocessable
    );
    assert_eq!(
        ForkChatError::UnavailableWithReason("needs a newer CLI".into()).status_kind(),
        StatusKind::Unprocessable
    );
    assert_eq!(
        ForkChatError::NothingToForkYet.status_kind(),
        StatusKind::Conflict
    );
    assert_eq!(
        ForkChatError::TranscriptMissing.status_kind(),
        StatusKind::Conflict
    );
    assert_eq!(
        ForkChatError::DirectoryMissing.status_kind(),
        StatusKind::Conflict
    );
    assert_eq!(
        ForkChatError::TurnInFlight.status_kind(),
        StatusKind::Conflict
    );
    assert_eq!(
        ForkChatError::MessageNotFound.status_kind(),
        StatusKind::NotFound
    );
    assert_eq!(
        ForkChatError::NotAUserMessage.status_kind(),
        StatusKind::BadRequest
    );
    assert_eq!(
        ForkChatError::MessageNotSent.status_kind(),
        StatusKind::Conflict
    );
    assert_eq!(
        ForkChatError::NothingBeforeMessage.status_kind(),
        StatusKind::Conflict
    );
    assert_eq!(
        ForkChatError::BeforeProviderSwitch("Codex".into()).status_kind(),
        StatusKind::Conflict
    );
    assert_eq!(
        ForkChatError::BeforeContextReset.status_kind(),
        StatusKind::Conflict
    );
    assert_eq!(
        ForkChatError::ForkPointUnresolved("gone".into()).status_kind(),
        StatusKind::Conflict
    );
    assert_eq!(
        ForkChatError::PinFailed("boom".into()).status_kind(),
        StatusKind::Internal
    );
    assert_eq!(
        ForkChatError::InsertFailed(SeamError::msg("boom")).status_kind(),
        StatusKind::Internal
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
