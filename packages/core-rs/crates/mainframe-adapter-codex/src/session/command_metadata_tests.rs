use super::*;
use crate::item_types::CommandExecutionItem;

fn session() -> CodexSession {
    CodexSession::new(
        SessionOptions {
            project_path: "/tmp".into(),
            chat_id: None,
            mainframe_chat_id: "command-test".into(),
            session_file_path: None,
            fork_source: None,
        },
        None,
        ResolvedPath::from_value("/usr/bin:/bin"),
        Arc::new(BackgroundTaskTracker::new()),
    )
}
fn item(actions: bool) -> CommandExecutionItem {
    serde_json::from_value(json!({"id":"same","command":"ls","status":"completed",
        "commandActions":if actions { json!([]) } else { Value::Null }}))
    .unwrap()
}
fn seed(session: &CodexSession) {
    let mut state = session.state.lock().unwrap();
    state.thread_id = Some("parent".into());
    state.current_turn_id = Some("turn".into());
    for thread in ["parent", "child"] {
        state.command_state.start_turn(thread, "turn");
        state
            .command_state
            .started(thread, Some("turn"), &item(true));
    }
}
fn assert_cleared(session: &CodexSession) {
    let mut state = session.state.lock().unwrap();
    for thread in ["parent", "child"] {
        state
            .command_state
            .started(thread, Some("turn"), &item(true));
        let mut completed = item(false);
        state
            .command_state
            .complete(thread, Some("turn"), &mut completed);
        assert!(completed.command_actions.is_none());
        state.command_state.start_turn(thread, "next");
        state
            .command_state
            .complete(thread, Some("next"), &mut completed);
        assert!(completed.command_actions.is_none());
    }
}
#[tokio::test]
async fn command_metadata_parent_interrupt_clears_parent_and_children() {
    let session = session();
    seed(&session);
    session.interrupt().await.unwrap();
    assert_cleared(&session);
}
#[tokio::test]
async fn command_metadata_session_kill_clears_parent_and_children() {
    let session = session();
    seed(&session);
    session.kill().await.unwrap();
    assert_cleared(&session);
}
