// ── chat-manager-background-activity.test.ts (enrichChat derivation) ──────────
// The TS test drives `manager.getChat` with a fake-timed tracker; the Rust port's
// backgroundActivity derivation lives in the private `enrich_chat`, tested here
// directly with fixed `startedAt` (Rust can't trivially freeze the clock).
mod background_activity {
    use super::*;
    use crate::chat_manager::shared::enrich_chat;
    use mainframe_types::background_task::{
        BackgroundActivity, BackgroundActivityTask, BackgroundTask, BackgroundTaskStatus,
        BackgroundTaskToolName, BackgroundWorkKind,
    };
    use mainframe_types::chat::DisplayStatus;
    use std::collections::HashMap;

    fn bg_task(id: &str, kind: BackgroundWorkKind, description: &str) -> BackgroundTask {
        BackgroundTask {
            id: id.to_string(),
            kind,
            tool_name: BackgroundTaskToolName::Bash,
            tool_use_id: format!("tu-{id}"),
            command: "cmd".to_string(),
            description: description.to_string(),
            output_path: None,
            started_at: 5000,
            ended_at: None,
            status: BackgroundTaskStatus::Running,
            last_output_line: None,
            summary: None,
            usage: None,
            recovered: None,
            workflow_name: None,
            run_id: None,
        }
    }

    fn act(id: &str, kind: BackgroundWorkKind, description: &str) -> BackgroundActivityTask {
        BackgroundActivityTask {
            id: id.to_string(),
            kind,
            description: description.to_string(),
            started_at: 5000,
            workflow_name: None,
            run_id: None,
        }
    }

    #[test]
    fn main_only_working_no_background() {
        let mut chat = working_chat("c-working", None, true);
        enrich_chat(&mut chat, false, &[], None, None);
        assert_eq!(chat.display_status, Some(DisplayStatus::Working));
        assert_eq!(chat.is_running, Some(true));
        assert_eq!(chat.background_activity, None);
    }

    #[test]
    fn background_only_idle_plus_live_tasks() {
        let mut chat = working_chat("c-idle", None, false);
        let tasks = vec![
            bg_task("a-1", BackgroundWorkKind::Agent, "reviewer"),
            bg_task("b-1", BackgroundWorkKind::Bash, "dev server"),
        ];
        enrich_chat(&mut chat, false, &tasks, None, None);
        assert_eq!(chat.display_status, Some(DisplayStatus::Working));
        assert_eq!(chat.is_running, Some(false));
        let by_kind = HashMap::from([
            (BackgroundWorkKind::Agent, 1),
            (BackgroundWorkKind::Bash, 1),
        ]);
        assert_eq!(
            chat.background_activity,
            Some(BackgroundActivity {
                total: 2,
                by_kind,
                tasks: vec![
                    act("a-1", BackgroundWorkKind::Agent, "reviewer"),
                    act("b-1", BackgroundWorkKind::Bash, "dev server"),
                ],
            })
        );
    }

    #[test]
    fn both_main_turn_and_background() {
        let mut chat = working_chat("c-working", None, true);
        let tasks = vec![bg_task("w-1", BackgroundWorkKind::Workflow, "deploy")];
        enrich_chat(&mut chat, false, &tasks, None, None);
        assert_eq!(chat.display_status, Some(DisplayStatus::Working));
        assert_eq!(chat.is_running, Some(true));
        assert_eq!(
            chat.background_activity,
            Some(BackgroundActivity {
                total: 1,
                by_kind: HashMap::from([(BackgroundWorkKind::Workflow, 1)]),
                tasks: vec![act("w-1", BackgroundWorkKind::Workflow, "deploy")],
            })
        );
    }

    #[test]
    fn terminal_tasks_do_not_count() {
        // Ended tasks never appear in listLive → an empty slice here.
        let mut chat = working_chat("c-idle", None, false);
        enrich_chat(&mut chat, false, &[], None, None);
        assert_eq!(chat.display_status, Some(DisplayStatus::Idle));
        assert_eq!(chat.background_activity, None);
    }

    #[test]
    fn delegated_task_keeps_parent_working_after_its_turn_ends() {
        let mut chat = working_chat("parent", None, false);
        chat.orchestration.has_running_delegated_task = true;
        enrich_chat(&mut chat, false, &[], None, None);
        assert_eq!(chat.display_status, Some(DisplayStatus::Working));
        assert_eq!(chat.is_running, Some(false));

        chat.orchestration.has_running_delegated_task = false;
        enrich_chat(&mut chat, false, &[], None, None);
        assert_eq!(chat.display_status, Some(DisplayStatus::Idle));
    }

    #[test]
    fn pending_permission_wins_over_background_activity() {
        let mut chat = working_chat("c-idle", None, false);
        let tasks = vec![bg_task("a-3", BackgroundWorkKind::Agent, "work")];
        enrich_chat(&mut chat, true, &tasks, None, None);
        assert_eq!(chat.display_status, Some(DisplayStatus::Waiting));
        assert_eq!(chat.is_running, Some(false));
        // The chip still shows the live background work while the gate is up.
        assert_eq!(chat.background_activity.map(|a| a.total), Some(1));
    }

    #[test]
    fn worktree_present_marks_directory_present() {
        let dir = tempfile::TempDir::new().unwrap();
        std::fs::create_dir(dir.path().join(".git")).unwrap();
        let mut chat = working_chat("c-wt-live", None, false);
        chat.worktree_path = Some(dir.path().to_string_lossy().into_owned());

        enrich_chat(&mut chat, false, &[], None, None);

        assert_eq!(chat.worktree_missing, Some(false));
        assert_eq!(chat.directory_missing, Some(false));
        assert_eq!(chat.missing_directory_path, None);
    }

    #[test]
    fn worktree_gone_marks_directory_missing() {
        let dir = tempfile::TempDir::new().unwrap();
        let path = dir.path().join("missing-worktree");
        let path = path.to_str().unwrap().to_string();
        let mut chat = working_chat("c-wt-gone", None, false);
        chat.worktree_path = Some(path.clone());

        enrich_chat(&mut chat, false, &[], Some("/project"), None);

        assert_eq!(chat.worktree_missing, Some(true));
        assert_eq!(chat.directory_missing, Some(true));
        assert_eq!(chat.missing_directory_path, Some(path));
    }

    #[test]
    fn project_path_gone_marks_directory_missing_without_worktree_missing() {
        let dir = tempfile::TempDir::new().unwrap();
        let path = dir.path().join("missing-project");
        let path = path.to_str().unwrap().to_string();
        let mut chat = working_chat("c-project-gone", None, false);

        enrich_chat(&mut chat, false, &[], Some(&path), None);

        assert_eq!(chat.worktree_missing, Some(false));
        assert_eq!(chat.directory_missing, Some(true));
        assert_eq!(chat.missing_directory_path, Some(path));
    }

    #[test]
    fn project_path_present_marks_directory_present() {
        let dir = tempfile::TempDir::new().unwrap();
        let mut chat = working_chat("c-project-live", None, false);

        enrich_chat(&mut chat, false, &[], dir.path().to_str(), None);

        assert_eq!(chat.worktree_missing, Some(false));
        assert_eq!(chat.directory_missing, Some(false));
        assert_eq!(chat.missing_directory_path, None);
    }

    #[test]
    fn missing_project_row_is_not_a_missing_directory() {
        let mut chat = working_chat("c-project-row-gone", None, false);

        enrich_chat(&mut chat, false, &[], None, None);

        assert_eq!(chat.worktree_missing, Some(false));
        assert_eq!(chat.directory_missing, Some(false));
        assert_eq!(chat.missing_directory_path, None);
    }
}

// ── Degraded chat recovery ────────────────────────────────────────────
fn history_message() -> ChatMessage {
    ChatMessage {
        id: "m1".to_string(),
        chat_id: "sess-1".to_string(),
        r#type: ChatMessageType::Assistant,
        content: vec![MessageContent::Leaf(
            mainframe_types::content::LeafContent::Text {
                text: "hello from history".to_string(),
                parent_tool_use_id: None,
            },
        )],
        timestamp: "2026-07-08T00:00:00.000Z".to_string(),
        metadata: None,
    }
}

#[tokio::test]
async fn get_display_messages_reports_transcript_missing_persists_and_emits() {
    let mut chat = test_chat("c1");
    chat.vendor_session_id = Some("sess-1".to_string());
    let deps = FakeDeps::with_chats(vec![chat]);
    *deps.adapters.transcript_present.lock().unwrap() = Some(false); // transcript gone
    let mgr = ChatManager::new(deps.clone());

    let result = mgr.get_display_messages("c1").await;

    assert!(result.transcript_missing);
    assert_eq!(
        deps.store
            .chats
            .lock()
            .unwrap()
            .get("c1")
            .unwrap()
            .transcript_missing,
        Some(true)
    );
    assert!(deps.events().iter().any(|e| matches!(
        e,
        DaemonEvent::ChatUpdated { chat, .. } if chat.transcript_missing == Some(true)
    )));
}

#[tokio::test]
async fn get_display_messages_self_heals_a_stale_flag() {
    let mut chat = test_chat("c1");
    chat.vendor_session_id = Some("sess-1".to_string());
    chat.transcript_missing = Some(true);
    let deps = FakeDeps::with_chats(vec![chat]);
    *deps.adapters.transcript_present.lock().unwrap() = Some(true); // transcript back
    *deps.adapters.history.lock().unwrap() = Some(vec![history_message()]);
    let mgr = ChatManager::new(deps.clone());

    let result = mgr.get_display_messages("c1").await;

    assert!(!result.transcript_missing);
    assert_eq!(
        deps.store
            .chats
            .lock()
            .unwrap()
            .get("c1")
            .unwrap()
            .transcript_missing,
        Some(false)
    );
}

#[tokio::test]
async fn send_message_with_the_flag_clears_the_dead_session_identity() {
    let mut chat = test_chat("c1");
    chat.vendor_session_id = Some("sess-1".to_string());
    chat.transcript_missing = Some(true);
    chat.session_file_path = Some("/home/u/.claude/projects/x/sess-1.jsonl".to_string());
    let deps = FakeDeps::with_chats(vec![chat]);
    let mgr = ChatManager::new(deps.clone());

    // No live session → the send triggers the auto "continue here" reset. The send
    // itself then can't spawn (no session double), but the reset already ran.
    let _ = mgr
        .send_message("c1", "continue after transcript loss", None, None)
        .await;

    let row = deps.store.chats.lock().unwrap().get("c1").cloned().unwrap();
    assert_eq!(row.vendor_session_id, None);
    assert_eq!(row.session_file_path, None);
    assert_eq!(row.transcript_missing, Some(false));
}
