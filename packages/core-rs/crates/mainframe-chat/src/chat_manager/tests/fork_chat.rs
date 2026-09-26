//! `ChatManager::fork_chat` (todo #343 Group 3, plan item 1). A child module of
//! `tests`, so it sees `tests`' private `StoreDeps`.

use super::*;

fn chat_with(id: &str, adapter_id: &str, claude_session_id: Option<&str>) -> Chat {
    // `enrich_chat`'s directory-missing check stats the real filesystem against
    // StoreDeps's fixed "/tmp/test" project path — make sure it exists so every
    // test below is about fork_chat's OWN gating, not directory presence.
    std::fs::create_dir_all("/tmp/test").expect("create the fake project dir");
    let mut c = test_chat(id);
    c.adapter_id = adapter_id.to_string();
    c.claude_session_id = claude_session_id.map(str::to_string);
    c.status = ChatStatus::Active;
    c
}

#[tokio::test]
async fn unknown_chat_id_is_not_found() {
    let deps = StoreDeps::arc();
    let mgr = ChatManager::new(deps);
    let err = mgr.fork_chat("nope").await.unwrap_err();
    assert_eq!(err, ForkChatError::NotFound("nope".to_string()));
    assert_eq!(err.status_code(), 404);
}

#[tokio::test]
async fn adapter_without_fork_capability_is_unsupported_422() {
    let chat = chat_with("c1", "codex", Some("sess-1"));
    let deps = StoreDeps::with_chats(vec![chat]);
    // adapter_fork_info defaults to `{ fork: false }` unless configured.
    let mgr = ChatManager::new(deps);
    let err = mgr.fork_chat("c1").await.unwrap_err();
    assert_eq!(err, ForkChatError::Unsupported("codex".to_string()));
    assert_eq!(err.status_code(), 422);
}

#[tokio::test]
async fn no_provider_session_is_nothing_to_fork_yet_409() {
    let chat = chat_with("c1", "claude", None);
    let deps = StoreDeps::with_chats(vec![chat]);
    deps.set_fork_capable(true);
    let mgr = ChatManager::new(deps);
    let err = mgr.fork_chat("c1").await.unwrap_err();
    assert_eq!(err, ForkChatError::NothingToForkYet);
    assert_eq!(err.status_code(), 409);
}

#[tokio::test]
async fn missing_transcript_is_refused_409() {
    let mut chat = chat_with("c1", "claude", Some("sess-1"));
    chat.transcript_missing = Some(true);
    let deps = StoreDeps::with_chats(vec![chat]);
    deps.set_fork_capable(true);
    let mgr = ChatManager::new(deps);
    let err = mgr.fork_chat("c1").await.unwrap_err();
    assert_eq!(err, ForkChatError::TranscriptMissing);
    assert_eq!(err.status_code(), 409);
}

#[tokio::test]
async fn a_running_turn_is_refused_409() {
    let mut chat = chat_with("c1", "claude", Some("sess-1"));
    chat.process_state = Some(Some(ProcessState::Working));
    let deps = StoreDeps::with_chats(vec![chat]);
    deps.set_fork_capable(true);
    let mgr = ChatManager::new(deps);
    let err = mgr.fork_chat("c1").await.unwrap_err();
    assert_eq!(err, ForkChatError::TurnInFlight);
    assert_eq!(err.status_code(), 409);
}

// Waiting-on-a-permission-answer coverage lives in fork_api.rs's
// `turn_in_flight_tests`: `get_chat`'s `enrich_chat` always recomputes
// `display_status`/`is_running` from live state (the permission manager's
// pending queue), so a fake chat's manually-set `Waiting` status here would
// never survive to `fork_chat`'s check — it isn't a meaningful test of this
// gate through `StoreDeps`.

/// Spec edge case: background tasks alone widen `display_status` to `Working`,
/// but the main turn isn't running — fork must still succeed.
#[tokio::test]
async fn an_idle_chat_with_background_tasks_only_still_forks() {
    let mut chat = chat_with("c1", "claude", Some("sess-1"));
    chat.display_status = Some(DisplayStatus::Working);
    chat.is_running = Some(false);
    let deps = StoreDeps::with_chats(vec![chat]);
    deps.set_fork_capable(true);
    let mgr = ChatManager::new(deps);
    assert!(mgr.fork_chat("c1").await.is_ok());
}

#[tokio::test]
async fn success_creates_the_fork_and_emits_chat_created() {
    let chat = chat_with("c1", "claude", Some("sess-1"));
    let deps = StoreDeps::with_chats(vec![chat]);
    deps.set_fork_capable(true);
    let mgr = ChatManager::new(deps.clone());

    let fork = mgr.fork_chat("c1").await.expect("fork should succeed");
    assert_eq!(fork.parent_chat_id, Some(Some("c1".to_string())));
    assert!(mgr.get_chat(&fork.id).is_some());
    assert!(
        deps.events()
            .iter()
            .any(|e| matches!(e, DaemonEvent::ChatCreated { chat, .. } if chat.id == fork.id))
    );
}

#[tokio::test]
async fn a_pin_failure_leaves_no_new_chat() {
    let chat = chat_with("c1", "claude", Some("sess-1"));
    let deps = StoreDeps::with_chats(vec![chat]);
    deps.set_fork_capable(true);
    deps.fail_pin("cli crashed");
    let mgr = ChatManager::new(deps.clone());
    let before = deps.chat_count();
    let err = mgr.fork_chat("c1").await.unwrap_err();
    assert_eq!(err, ForkChatError::PinFailed("cli crashed".to_string()));
    assert_eq!(err.status_code(), 500);
    assert_eq!(deps.chat_count(), before);
}

#[tokio::test]
async fn a_pin_transcript_missing_maps_to_409_not_500() {
    let chat = chat_with("c1", "claude", Some("sess-1"));
    let deps = StoreDeps::with_chats(vec![chat]);
    deps.set_fork_capable(true);
    deps.fail_pin_transcript_missing();
    let mgr = ChatManager::new(deps);
    let err = mgr.fork_chat("c1").await.unwrap_err();
    assert_eq!(err, ForkChatError::TranscriptMissing);
    assert_eq!(err.status_code(), 409);
}

/// The parent's own adapter capability said yes, but the adapter's own pin
/// mechanism refuses anyway (e.g. a mock configured with `fork: true` on the
/// capability but no real pin support) — still a 422, not a 500.
#[tokio::test]
async fn a_pin_unsupported_after_capability_passed_is_still_422() {
    let chat = chat_with("c1", "claude", Some("sess-1"));
    let deps = StoreDeps::with_chats(vec![chat]);
    deps.set_fork_capable(true);
    deps.fail_pin_unsupported();
    let mgr = ChatManager::new(deps);
    let err = mgr.fork_chat("c1").await.unwrap_err();
    assert_eq!(err, ForkChatError::Unsupported("claude".to_string()));
    assert_eq!(err.status_code(), 422);
}

#[tokio::test]
async fn an_insert_failure_leaves_no_new_chat() {
    let chat = chat_with("c1", "claude", Some("sess-1"));
    let deps = StoreDeps::with_chats(vec![chat]);
    deps.set_fork_capable(true);
    deps.fail_create_fork("db is full");
    let mgr = ChatManager::new(deps.clone());
    let before = deps.chat_count();
    let err = mgr.fork_chat("c1").await.unwrap_err();
    assert_eq!(err, ForkChatError::InsertFailed("db is full".to_string()));
    assert_eq!(err.status_code(), 500);
    assert_eq!(deps.chat_count(), before);
}
