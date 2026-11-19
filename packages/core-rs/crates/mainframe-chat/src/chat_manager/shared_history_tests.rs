use super::*;
use crate::test_support::{FakeDeps, test_chat};

#[test]
fn scratch_history_session_survives_missing_hidden_project() {
    let deps = FakeDeps::arc();
    *deps.paths.project_path.lock_recover() = None;
    *deps.adapters.history.lock_recover() = Some(Vec::new());
    let mut chat = test_chat("scratch");
    chat.project_id = mainframe_types::chat::NO_PROJECT_ID.into();
    chat.no_project = true;
    chat.scratch_path = Some("/isolated/scratch/chat".into());
    chat.vendor_session_id = Some("provider-session".into());
    chat.session_file_path = Some("/isolated/transcript.jsonl".into());
    let port: Arc<dyn ChatManagerDeps> = deps.clone();
    assert!(build_history_session(&port, &chat, "scratch").is_some());
    let created = deps.adapters.created_sessions.lock_recover();
    assert_eq!(created[0].project_path, "/isolated/scratch/chat");
    assert_eq!(created[0].chat_id.as_deref(), Some("provider-session"));
    assert_eq!(created[0].session_file_path, chat.session_file_path);
}
