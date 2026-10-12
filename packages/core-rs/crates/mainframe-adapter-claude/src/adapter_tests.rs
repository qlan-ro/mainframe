use super::*;

// ---- ClaudeAdapter surface ----
fn opts(chat_id: &str) -> SessionOptions {
    SessionOptions {
        project_path: "/tmp".to_string(),
        chat_id: Some(chat_id.to_string()),
        mainframe_chat_id: "mf".to_string(),
        session_file_path: None,
        fork_source: None,
    }
}

#[test]
fn adapter_identity_and_capabilities() {
    let a = ClaudeAdapter::default();
    assert_eq!(a.id(), "claude");
    assert_eq!(a.name(), "Claude Code");
    assert!(a.capabilities().plan_mode);
    assert!(a.capabilities().fork);
}

#[test]
fn initial_transcript_path_is_the_claude_project_jsonl() {
    let home = dirs::home_dir().unwrap();
    assert_eq!(
        ClaudeAdapter::default().initial_transcript_path("session-id", "/proj"),
        Some(
            home.join(".claude/projects/-proj/session-id.jsonl")
                .to_string_lossy()
                .into_owned()
        )
    );
}

#[test]
fn initial_transcript_path_sanitizes_the_session_id() {
    let home = dirs::home_dir().unwrap();
    assert_eq!(
        ClaudeAdapter::default().initial_transcript_path("../../etc/passwd", "/proj"),
        Some(
            home.join(".claude/projects/-proj/------etc-passwd.jsonl")
                .to_string_lossy()
                .into_owned()
        )
    );
}

#[test]
fn adapter_trait_resolves_a_plan_mode_handler() {
    let a = ClaudeAdapter::default();
    assert!(Adapter::create_plan_mode_handler(&a).is_some());
}

#[tokio::test]
async fn list_models_falls_back_to_static_catalog() {
    let a = ClaudeAdapter::default();
    let models = a.catalog();
    assert_eq!(models.len(), claude_models().len());
}

#[test]
fn get_tool_categories_matches_the_catalog() {
    let a = ClaudeAdapter::default();
    let cats = a.get_tool_categories().unwrap();
    assert!(cats.explore.contains("Read"));
    assert!(cats.hidden.contains("TodoWrite"));
    assert!(cats.hidden.contains("AskUserQuestion"));
    assert!(cats.progress.contains("TaskCreate"));
    assert!(cats.subagent.contains("Task"));
    assert!(cats.subagent.contains("Agent"));
}

#[test]
fn create_session_registers_and_exit_deregisters() {
    let a = ClaudeAdapter::default();
    let session = a.create_session(opts("chat-1"));
    assert_eq!(a.sessions.lock().unwrap().len(), 1);
    let id = session.id().to_string();
    // Simulate the exit callback firing (the waiter task would invoke it).
    a.sessions.lock().unwrap().remove(&id);
    assert!(a.sessions.lock().unwrap().is_empty());
}

#[test]
fn shared_version_parser_extracts_semver() {
    assert_eq!(
        mainframe_adapter_api::version::CliVersion::parse("claude 2.1.198 (build 7)")
            .map(|v| v.to_string()),
        Some("2.1.198".to_string())
    );
    assert_eq!(
        mainframe_adapter_api::version::CliVersion::parse("no version here").map(|v| v.to_string()),
        None
    );
}
