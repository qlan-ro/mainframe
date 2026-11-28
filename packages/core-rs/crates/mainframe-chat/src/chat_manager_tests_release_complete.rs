//! A restore counts only a complete read: a real Claude transcript that is
//! missing or reads partly keeps the chat released, a segment layout that
//! cannot be read keeps it released, and a permission answer never writes to a
//! released chat. Also: restores never leave adapter-tracked sessions behind.

use super::restore::{released_reading_through, started, two_segment_layout};
use super::*;
use mainframe_adapter_api::Adapter as _;
use mainframe_types::adapter::{ControlBehavior, ControlResponse, ControlUpdate};

fn claude_line(id: &str) -> String {
    serde_json::json!({
        "type": "assistant", "uuid": id, "sessionId": "session",
        "timestamp": "2026-11-28T00:00:00Z",
        "message": {"content": [{"type": "text", "text": "synthetic"}]}
    })
    .to_string()
}

/// A released "c1" whose restore reads a real Claude session over `dir`.
async fn released_over_claude(dir: &std::path::Path) -> Fixture {
    let f = fixture();
    scan(&f.mgr).await;
    assert!(f.mgr.shared.messages.lock().unwrap().is_released("c1"));
    let session = mainframe_adapter_claude::adapter::ClaudeAdapter::default()
        .create_history_session(mainframe_types::adapter::SessionOptions {
            project_path: dir.to_str().unwrap().into(),
            chat_id: Some("session".into()),
            session_file_path: Some(dir.join("session.jsonl").to_str().unwrap().into()),
            mainframe_chat_id: "c1".into(),
            fork_source: None,
        });
    f.deps.set_session_to_return(session);
    f
}

fn released(f: &Fixture) -> bool {
    f.mgr.shared.messages.lock().unwrap().is_released("c1")
}

#[tokio::test]
async fn an_empty_claude_transcript_is_installed() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("session.jsonl"), "").unwrap();
    let f = released_over_claude(dir.path()).await;

    f.mgr.lifecycle.load_chat("c1").await;

    assert!(!released(&f));
    assert!(holds_history(&f.mgr));
}

#[tokio::test]
async fn a_claude_transcript_gone_since_the_release_keeps_the_chat_released() {
    let dir = tempfile::tempdir().unwrap();
    let f = released_over_claude(dir.path()).await;

    f.mgr.lifecycle.load_chat("c1").await;

    assert!(released(&f), "a missing transcript is not an empty history");
    assert!(!holds_history(&f.mgr));
}

#[tokio::test]
async fn a_claude_transcript_that_reads_only_in_part_keeps_the_chat_released() {
    use std::os::unix::fs::PermissionsExt as _;
    let dir = tempfile::tempdir().unwrap();
    let primary = dir.path().join("session.jsonl");
    std::fs::write(&primary, claude_line("first")).unwrap();
    std::fs::write(dir.path().join("resume.jsonl"), claude_line("second")).unwrap();
    std::fs::set_permissions(&primary, std::fs::Permissions::from_mode(0o000)).unwrap();
    if std::fs::File::open(&primary).is_ok() {
        return; // Running as a user that reads anything; nothing to test.
    }
    let f = released_over_claude(dir.path()).await;

    f.mgr.lifecycle.load_chat("c1").await;

    std::fs::set_permissions(&primary, std::fs::Permissions::from_mode(0o600)).unwrap();
    assert!(
        released(&f),
        "the sibling's records do not make the history whole"
    );
    assert!(!holds_history(&f.mgr));
}

#[tokio::test]
async fn a_segment_layout_that_cannot_be_read_keeps_the_chat_released() {
    use crate::chat_manager::tests::segment_fake::FakeStore;
    use std::sync::atomic::Ordering;
    std::fs::create_dir_all("/tmp/test").expect("create the fake project dir");
    let f = fixture();
    let store = FakeStore::with_layout(two_segment_layout());
    f.deps.set_segment_store(store.clone());
    scan(&f.mgr).await;
    assert!(released(&f));

    store.fail_layout.store(true, Ordering::SeqCst);
    f.mgr.lifecycle.load_chat("c1").await;

    assert!(
        released(&f),
        "only the active provider's part would come back"
    );
    assert!(!holds_history(&f.mgr));
}

#[tokio::test]
async fn a_chat_whose_segment_layout_cannot_be_read_is_not_released() {
    use crate::chat_manager::tests::segment_fake::FakeStore;
    use std::sync::atomic::Ordering;
    std::fs::create_dir_all("/tmp/test").expect("create the fake project dir");
    let f = fixture();
    let store = FakeStore::with_layout(two_segment_layout());
    store.fail_layout.store(true, Ordering::SeqCst);
    f.deps.set_segment_store(store);

    scan(&f.mgr).await;

    assert!(!released(&f));
    assert!(holds_history(&f.mgr));
}

/// An answer whose permissions are partly ungrantable makes the daemon write
/// a notice the transcript never holds.
fn answer() -> ControlResponse {
    ControlResponse {
        request_id: "r1".into(),
        tool_use_id: "t1".into(),
        tool_name: Some("Bash".into()),
        behavior: ControlBehavior::Allow,
        updated_input: None,
        updated_permissions: Some(vec![ControlUpdate::Unknown(serde_json::json!({}))]),
        message: None,
        execution_mode: None,
        clear_context: None,
        scope: None,
    }
}

#[tokio::test]
async fn a_permission_answer_to_a_chat_that_cannot_be_restored_fails_as_retryable() {
    let (f, session) = released_reading_through(FakeSession {
        history: vec![message("m1"), message("m2")],
        history_read_failed: true,
        spawn_ok: true,
        ..Default::default()
    })
    .await;

    let err = f
        .mgr
        .respond_to_permission("c1", answer())
        .await
        .expect_err("the answer cannot land");

    assert!(err.to_string().contains("Try again"), "{err}");
    assert!(
        released(&f),
        "nothing was appended to a history the daemon does not hold"
    );
    assert!(!started(&f));
    assert!(session.spawn_options.lock().unwrap().is_none());
}

#[tokio::test]
async fn a_permission_answer_restores_the_history_before_its_notice() {
    let (f, _) = released_reading_through(FakeSession {
        history: vec![message("m1"), message("m2")],
        spawn_ok: true,
        ..Default::default()
    })
    .await;

    f.mgr.respond_to_permission("c1", answer()).await.unwrap();

    let ids = cached_ids(&f.mgr);
    assert_eq!(&ids[..2], ["m1", "m2"], "the whole history came back first");
    assert_eq!(ids.len(), 3, "then the daemon's notice: {ids:?}");
}

#[tokio::test]
async fn restores_read_through_untracked_history_sessions_only() {
    use std::sync::atomic::Ordering;
    let f = fixture();
    for _ in 0..3 {
        scan(&f.mgr).await;
        assert!(released(&f));
        f.mgr.lifecycle.load_chat("c1").await;
        assert!(holds_history(&f.mgr));
        f.mgr
            .set_last_used_at_for_test("c1", now_ms() - 60 * MINUTE);
    }

    let created = f.deps.created_sessions().len();
    assert_eq!(
        f.deps.adapters.history_sessions.load(Ordering::SeqCst),
        created,
        "every session the restores made is history-only, so none is tracked"
    );
    assert!(created >= 3);
}
