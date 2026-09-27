#![allow(clippy::unwrap_used, clippy::expect_used)]

#[path = "support/model_session.rs"]
mod model_session;
mod support;

use model_session::{ModelSession, SESSION_ID};
use serde_json::Value;

#[tokio::test]
async fn explicit_choice_survives_process_restart_and_runtime_resolution() {
    let fixture = ModelSession::new().await;
    assert_eq!(fixture.running_model().await, "claude-fable-5-1");
    assert_eq!(fixture.saved_model().await, "default");

    fixture.select("opus").await.unwrap();
    assert_eq!(fixture.saved_model().await, "opus");
    assert_eq!(fixture.running_model().await, "claude-opus-5-5");
    fixture.stop().await;
    assert_eq!(fixture.running_model().await, Value::Null);

    fixture.configure("claude-haiku-4-5");
    fixture.resume().await;
    assert_eq!(fixture.saved_model().await, "opus");
    assert_eq!(fixture.running_model().await, "claude-opus-5-5");
    let launches = fixture.session_launches();
    assert_eq!(launches.len(), 2);
    assert!(
        launches[0]
            .windows(2)
            .any(|pair| pair == ["--model", "claude-fable-5-1"])
    );
    assert!(
        launches[1]
            .windows(2)
            .any(|pair| pair == ["--model", "opus"])
    );
    assert!(
        launches[1]
            .windows(2)
            .any(|pair| pair == ["--resume", SESSION_ID])
    );
    fixture.stop().await;
}

#[tokio::test]
async fn returning_to_inheritance_tracks_cli_configuration_after_resume() {
    let fixture = ModelSession::new().await;
    fixture.select("opus").await.unwrap();
    fixture.select("default").await.unwrap();
    assert_eq!(fixture.saved_model().await, "default");
    assert_eq!(fixture.running_model().await, "claude-fable-5-1");
    fixture.stop().await;

    fixture.configure("claude-haiku-4-5");
    fixture.resume().await;
    assert_eq!(fixture.saved_model().await, "default");
    assert_eq!(fixture.running_model().await, "claude-haiku-4-5");
    let launches = fixture.session_launches();
    assert_eq!(launches.len(), 2);
    assert!(
        launches[1]
            .windows(2)
            .any(|pair| pair == ["--model", "claude-haiku-4-5"])
    );
    assert!(
        launches[1]
            .windows(2)
            .any(|pair| pair == ["--resume", SESSION_ID])
    );
    fixture.stop().await;
}

#[tokio::test]
async fn rejected_switch_preserves_saved_and_running_models() {
    let fixture = ModelSession::new().await;
    fixture.select("opus").await.unwrap();
    let error = fixture.select("rejected-model").await.unwrap_err();
    assert!(error.to_string().contains("Model unavailable"));
    assert_eq!(fixture.saved_model().await, "opus");
    assert_eq!(fixture.running_model().await, "claude-opus-5-5");
    fixture.stop().await;
    fixture.resume().await;
    assert_eq!(fixture.running_model().await, "claude-opus-5-5");
    assert_eq!(fixture.saved_model().await, "opus");
    fixture.stop().await;
}

#[tokio::test]
async fn unresolved_inheritance_cannot_silently_resume_the_transcript_model() {
    let fixture = ModelSession::new().await;
    fixture.stop().await;
    std::fs::remove_file(fixture.0.server.ctx.data_dir.join("configured-model")).unwrap();

    fixture.manager().start_chat(&fixture.0.chat_id).await;

    assert!(!fixture.manager().is_chat_running(&fixture.0.chat_id));
    assert_eq!(fixture.saved_model().await, "default");
    assert_eq!(fixture.running_model().await, Value::Null);
    assert_eq!(fixture.session_launches().len(), 1);
}

#[tokio::test]
async fn failed_inheritance_switch_keeps_the_explicit_selection() {
    let fixture = ModelSession::new().await;
    fixture.select("opus").await.unwrap();
    std::fs::remove_file(fixture.0.server.ctx.data_dir.join("configured-model")).unwrap();

    assert!(fixture.select("default").await.is_err());

    assert_eq!(fixture.saved_model().await, "opus");
    assert_eq!(fixture.running_model().await, "claude-opus-5-5");
    fixture.stop().await;
}

#[tokio::test]
async fn chat_override_wins_over_provider_settings_and_cli_configuration_on_resume() {
    let fixture = ModelSession::with_models(None, Some("opus")).await;
    assert_eq!(fixture.running_model().await, "claude-opus-5-5");

    fixture.select("claude-haiku-4-5").await.unwrap();
    assert_eq!(fixture.saved_model().await, "claude-haiku-4-5");
    assert_eq!(fixture.running_model().await, "claude-haiku-4-5");
    fixture.stop().await;
    fixture.provider_model("claude-sonnet-5").await;
    fixture.configure("claude-fable-5-1");

    fixture.resume().await;

    assert_eq!(fixture.saved_model().await, "claude-haiku-4-5");
    assert_eq!(fixture.running_model().await, "claude-haiku-4-5");
    fixture.stop().await;
}
