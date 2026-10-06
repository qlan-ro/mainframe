//! Tests for `session.rs`, kept apart so that file stays under 300 lines.

use super::*;
use mainframe_adapter_api::AdapterSession;

#[tokio::test]
async fn missing_fixture_fails_spawn_with_path() {
    let options = SessionOptions {
        project_path: "/tmp/project".to_string(),
        chat_id: None,
        mainframe_chat_id: "chat-1".to_string(),
        session_file_path: None,
        fork_source: None,
    };
    let session = ReplaySession::from_fixture(
        options,
        PathBuf::from("/tmp/missing-recording.ndjson"),
        Arc::new(ReplayCache::default()),
    );

    let error = session.spawn(None, None).await.unwrap_err();

    assert!(error.to_string().contains("/tmp/missing-recording.ndjson"));
    assert!(error.to_string().contains("fixture not found"));
}

#[tokio::test]
async fn fixture_project_path_placeholder_resolves_to_the_live_project() {
    let dir = tempfile::tempdir().unwrap();
    let fixture = dir.path().join("recording.ndjson");
    tokio::fs::write(
        &fixture,
        r#"{"dir":"out","method":"onMessage","args":[[{"type":"tool_use","id":"t1","name":"Read","input":{"file_path":"{{PROJECT_PATH}}/index.ts"}}]],"delayMs":0}"#,
    )
    .await
    .unwrap();
    let options = SessionOptions {
        project_path: "/tmp/live-project".to_string(),
        chat_id: None,
        mainframe_chat_id: "chat-1".to_string(),
        session_file_path: None,
        fork_source: None,
    };
    let session = ReplaySession::from_fixture(options, fixture, Arc::new(ReplayCache::default()));

    session.ensure_loaded().await.unwrap();

    let state = session.state.lock().unwrap();
    let file_path = state.replay.events[0].args[0][0]["input"]["file_path"].as_str();
    assert_eq!(file_path, Some("/tmp/live-project/index.ts"));
}
