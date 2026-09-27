#![cfg(unix)]
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod model_support;

use mainframe_adapter_api::{Adapter, AdapterSession};
use mainframe_adapter_codex::CodexAdapter;
use model_support::Fixture;

#[tokio::test]
async fn configured_model_uses_the_selected_cli_configuration() {
    let fixture = Fixture::new();
    let model = CodexAdapter::default()
        .configured_model(fixture.project(), Some(fixture.executable()))
        .await;
    assert_eq!(model.as_deref(), Some("cli-configured"));
    assert!(
        !fixture
            .requests()
            .iter()
            .any(|v| v["method"] == "turn/start")
    );
}

#[tokio::test]
async fn inherited_resume_replaces_the_saved_thread_model_with_cli_configuration() {
    let fixture = Fixture::new();
    let session = fixture.session("default", true).await;
    session
        .send_message("hello".into(), vec![], None)
        .await
        .unwrap();
    let requests = fixture.requests();
    let resume = requests
        .iter()
        .find(|v| v["method"] == "thread/resume")
        .unwrap();
    assert_eq!(resume["params"]["model"], "cli-configured");
    let turn = requests
        .iter()
        .find(|v| v["method"] == "turn/start")
        .unwrap();
    assert_eq!(
        turn["params"]["collaborationMode"]["settings"]["model"],
        "cli-configured"
    );
    session.kill().await.unwrap();
}

#[tokio::test]
async fn pending_switch_reports_the_live_model_until_the_next_turn() {
    let fixture = Fixture::new();
    let session = fixture.session("chat-selected", false).await;
    assert_eq!(session.effective_model().await, None);
    session
        .send_message("hello".into(), vec![], None)
        .await
        .unwrap();
    assert_eq!(
        session.effective_model().await.as_deref(),
        Some("chat-selected")
    );
    session.set_model("other-model".into()).await.unwrap();
    assert_eq!(
        session.effective_model().await.as_deref(),
        Some("chat-selected")
    );
    session
        .send_message("next".into(), vec![], None)
        .await
        .unwrap();
    assert_eq!(
        session.effective_model().await.as_deref(),
        Some("other-model")
    );
    session.set_model("default".into()).await.unwrap();
    assert_eq!(
        session.effective_model().await.as_deref(),
        Some("other-model")
    );
    session
        .send_message("inherited".into(), vec![], None)
        .await
        .unwrap();
    assert_eq!(
        session.effective_model().await.as_deref(),
        Some("cli-configured")
    );
    session.kill().await.unwrap();
}

#[tokio::test]
async fn no_configured_model_is_resolved_by_the_cli_without_starting_a_turn() {
    let fixture = Fixture::new();
    std::fs::write(
        std::path::Path::new(&fixture.project()).join("no-config"),
        "",
    )
    .unwrap();
    let model = CodexAdapter::default()
        .configured_model(fixture.project(), Some(fixture.executable()))
        .await;
    assert_eq!(model.as_deref(), Some("cli-native"));
    let requests = fixture.requests();
    let start = requests
        .iter()
        .find(|v| v["method"] == "thread/start")
        .unwrap();
    assert_eq!(start["params"]["ephemeral"], true);
    assert!(start["params"].get("model").is_none());
    assert!(!requests.iter().any(|v| v["method"] == "turn/start"));
}

#[tokio::test]
async fn explicit_model_survives_switch_stop_and_resume() {
    let fixture = Fixture::new();
    let first = fixture.session("first-model", false).await;
    first
        .send_message("hello".into(), vec![], None)
        .await
        .unwrap();
    first.set_model("saved-chat-model".into()).await.unwrap();
    first.kill().await.unwrap();
    let resumed = fixture.session("saved-chat-model", true).await;
    resumed
        .send_message("resume".into(), vec![], None)
        .await
        .unwrap();
    assert_eq!(
        resumed.effective_model().await.as_deref(),
        Some("saved-chat-model")
    );
    let requests = fixture.requests();
    let resume = requests
        .iter()
        .find(|v| v["method"] == "thread/resume")
        .unwrap();
    assert_eq!(resume["params"]["model"], "saved-chat-model");
    resumed.kill().await.unwrap();
}

#[tokio::test]
async fn inherited_new_session_never_sends_the_default_sentinel_to_codex() {
    let fixture = Fixture::new();
    let session = fixture.session("default", false).await;
    session
        .send_message("hello".into(), vec![], None)
        .await
        .unwrap();
    let requests = fixture.requests();
    let start = requests
        .iter()
        .find(|v| v["method"] == "thread/start")
        .unwrap();
    assert!(start["params"].get("model").is_none());
    assert_eq!(
        session.effective_model().await.as_deref(),
        Some("cli-configured")
    );
    session.kill().await.unwrap();
}

#[tokio::test]
async fn inherited_fork_keeps_the_cli_configuration_on_later_turns() {
    let fixture = Fixture::new();
    let session = fixture.fork_session("default").await;
    session
        .send_message("first".into(), vec![], None)
        .await
        .unwrap();
    assert_eq!(
        session.effective_model().await.as_deref(),
        Some("cli-configured")
    );
    session
        .send_message("second".into(), vec![], None)
        .await
        .unwrap();
    assert_eq!(
        session.effective_model().await.as_deref(),
        Some("cli-configured")
    );
    session.kill().await.unwrap();
}

#[tokio::test]
async fn inherited_model_without_a_cli_report_never_uses_a_provider_catalog_hint() {
    let fixture = Fixture::new();
    std::fs::write(
        std::path::Path::new(&fixture.project()).join("missing-model"),
        "",
    )
    .unwrap();
    let session = fixture.session_with_hint("default", "provider-hint").await;
    assert!(
        session
            .send_message("hello".into(), vec![], None)
            .await
            .is_err()
    );
    assert!(
        !fixture
            .requests()
            .iter()
            .any(|v| v["method"] == "turn/start")
    );
    session.kill().await.unwrap();
}
