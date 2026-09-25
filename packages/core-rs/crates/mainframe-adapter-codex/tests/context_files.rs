#![allow(clippy::unwrap_used, clippy::expect_used)]

use mainframe_adapter_api::Adapter;
use mainframe_adapter_codex::CodexAdapter;
use mainframe_types::adapter::SessionOptions;

#[test]
fn codex_context_uses_agents_for_live_and_inactive_sessions() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("AGENTS.md"), "codex instructions").unwrap();
    std::fs::write(dir.path().join("CLAUDE.md"), "claude instructions").unwrap();
    let adapter = CodexAdapter::default();
    let path = dir.path().to_str().unwrap();
    let files = adapter.get_context_files(path).expect("Codex context");
    assert_eq!(files.project.len(), 1);
    assert_eq!(files.project[0].path, "AGENTS.md");
    let session = adapter.create_session(SessionOptions {
        project_path: path.into(),
        chat_id: None,
        mainframe_chat_id: "test".into(),
        session_file_path: None,
    });
    assert_eq!(session.get_context_files().project, files.project);
}
