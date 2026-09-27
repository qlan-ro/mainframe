use super::{
    tests::{session, spawned_with_stdin},
    *,
};
use std::os::unix::fs::PermissionsExt;

#[tokio::test]
async fn reads_the_live_model_without_sending_a_user_turn() {
    let session = session();
    let mut writes = spawned_with_stdin(&session);
    let other = session.clone();
    let result = tokio::spawn(async move { other.effective_model().await });
    let bytes = writes.recv().await.unwrap();
    let request: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(request["request"]["subtype"], "get_settings");
    let id = request["request_id"].as_str().unwrap();
    session.control.resolve(
        id,
        Some(json!({"subtype":"success", "response":{
            "applied":{"model":"claude-fable-5-1"}
        }})),
    );
    assert_eq!(result.await.unwrap().as_deref(), Some("claude-fable-5-1"));
}

#[tokio::test]
async fn proxy_runtime_model_keeps_its_endpoint_namespace() {
    let session = session();
    session.shared.endpoint.store(true, Ordering::SeqCst);
    let mut writes = spawned_with_stdin(&session);
    let other = session.clone();
    let result = tokio::spawn(async move { other.effective_model().await });
    let bytes = writes.recv().await.unwrap();
    let request: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(request["request"]["subtype"], "get_settings");
    session.control.resolve(
        request["request_id"].as_str().unwrap(),
        Some(json!({
            "subtype":"success", "response":{"applied":{"model":"gpt-5.6-sol"}}
        })),
    );

    assert_eq!(
        result.await.unwrap().as_deref(),
        Some("cliproxy/gpt-5.6-sol")
    );
}

#[test]
fn model_restart_requirement_uses_the_running_endpoint() {
    let session = session();
    for (proxy, requested, restart) in [
        (false, "claude-opus-5-5", false),
        (false, "cliproxy/gpt-5.6-sol", true),
        (true, "claude-opus-5-5", true),
        (true, "cliproxy/kimi-k3", false),
        (true, "default", true),
        (false, "default", false),
    ] {
        session.shared.endpoint.store(proxy, Ordering::SeqCst);
        assert_eq!(
            session.model_requires_restart(requested),
            restart,
            "proxy={proxy}, requested={requested}"
        );
    }
}

#[tokio::test]
async fn selecting_cli_settings_resolves_configuration_before_switching_live_model() {
    let session = session();
    let dir = tempfile::tempdir().unwrap();
    let exe = dir.path().join("configured-claude");
    std::fs::write(&exe, r#"#!/bin/sh
read -r request
printf '%s\n' '{"type":"control_response","response":{"request_id":"effective-model","subtype":"success","response":{"applied":{"model":"claude-fable-5-1"}}}}'
"#).unwrap();
    std::fs::set_permissions(&exe, std::fs::Permissions::from_mode(0o755)).unwrap();
    *session.executable.lock().unwrap() = exe.to_string_lossy().into_owned();
    let mut writes = spawned_with_stdin(&session);
    let other = session.clone();
    let result = tokio::spawn(async move { other.set_model("default".into()).await });
    let bytes = tokio::time::timeout(std::time::Duration::from_secs(5), writes.recv())
        .await
        .unwrap()
        .unwrap();
    let request: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(request["request"]["model"], "claude-fable-5-1");
    let id = request["request_id"].as_str().unwrap();
    session
        .control
        .resolve(id, Some(json!({"subtype":"success"})));
    result.await.unwrap().unwrap();
}
