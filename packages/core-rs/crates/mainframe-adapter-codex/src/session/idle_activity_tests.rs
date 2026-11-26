use super::*;
use mainframe_adapter_api::test_support::RecordingSink;

fn session() -> CodexSession {
    CodexSession::new(
        SessionOptions {
            project_path: "/tmp".into(),
            chat_id: None,
            mainframe_chat_id: "chat".into(),
            session_file_path: None,
            fork_source: None,
        },
        None,
        ResolvedPath::from_value("/usr/bin:/bin"),
        Arc::new(BackgroundTaskTracker::new()),
    )
}

#[test]
fn codex_idle_clock_tracks_work_without_counting_status_pings() {
    let session = session();
    let handlers = session.build_handlers(Arc::new(ApprovalHandler::new(Arc::new(
        RecordingSink::default(),
    ))));
    for method in [
        "thread/started",
        "turn/started",
        "turn/completed",
        "item/started",
        "item/agentMessage/delta",
        "item/completed",
        "thread/compacted",
        "serverRequest/resolved",
    ] {
        session.last_activity_ms.store(42, Ordering::SeqCst);
        (handlers.on_notification)(method.into(), Value::Null);
        assert!(session.last_activity_at().unwrap() > 42, "{method}");
    }
    for method in [
        "thread/status/changed",
        "account/rateLimits/updated",
        "thread/tokenUsage/updated",
    ] {
        session.last_activity_ms.store(42, Ordering::SeqCst);
        (handlers.on_notification)(method.into(), Value::Null);
        assert_eq!(session.last_activity_at(), Some(42), "{method}");
    }
}

#[test]
fn codex_pending_server_approval_blocks_idle_release_until_answered() {
    let session = session();
    let approval = Arc::new(ApprovalHandler::new(Arc::new(RecordingSink::default())));
    *session.approval_handler.lock_recover() = Some(approval.clone());
    let handlers = session.build_handlers(approval);
    session.last_activity_ms.store(42, Ordering::SeqCst);
    assert!(!session.blocks_idle_offload());
    (handlers.on_request)(
        "item/fileChange/requestApproval".into(),
        json!({"itemId":"file"}),
        crate::types::RequestId::Number(7),
    );
    assert!(session.blocks_idle_offload());
    assert!(session.last_activity_at().unwrap() > 42);
    (handlers.on_notification)("serverRequest/resolved".into(), json!({"requestId":7}));
    assert!(!session.blocks_idle_offload());
}

#[test]
fn codex_turn_and_child_work_individually_block_idle_release() {
    let session = session();
    assert!(!session.blocks_idle_offload());
    session.state.lock_recover().current_turn_id = Some("turn".into());
    assert!(session.blocks_idle_offload());
    session.state.lock_recover().current_turn_id = None;
    assert!(!session.blocks_idle_offload());
    session
        .state
        .lock_recover()
        .agent_task_ids
        .insert("child".into(), "task".into());
    assert!(session.blocks_idle_offload());
    session.state.lock_recover().agent_task_ids.clear();
    assert!(!session.blocks_idle_offload());
}

#[test]
fn codex_native_compaction_blocks_idle_release() {
    use mainframe_adapter_api::idle_compaction::{CompactionOrigin, NativeCompactionRequest};
    let session = session();
    let maintenance = session.state.lock_recover().maintenance.clone();
    let _completion = maintenance
        .begin(NativeCompactionRequest {
            id: "compact".into(),
            session_generation: session.id.clone(),
            origin: CompactionOrigin::Idle,
            command_uuid: "command".into(),
        })
        .unwrap();
    assert!(session.blocks_idle_offload());
    maintenance.finish(false);
    assert!(!session.blocks_idle_offload());
}

#[test]
fn codex_live_background_work_blocks_idle_release() {
    use mainframe_background_tasks::tracker::TaskSeed;
    use mainframe_types::background_task::{BackgroundTaskToolName, BackgroundWorkKind};
    let session = session();
    let tracker = session
        .state
        .lock_recover()
        .background_tasks
        .clone()
        .unwrap();
    tracker.start(
        "chat",
        TaskSeed {
            id: "task".into(),
            kind: BackgroundWorkKind::Bash,
            tool_name: BackgroundTaskToolName::Bash,
            tool_use_id: "tool".into(),
            command: "".into(),
            description: "".into(),
            workflow_name: None,
        },
        "/tmp/test-only-output".into(),
    );
    assert!(session.blocks_idle_offload());
    tracker.end_all_running("chat");
    assert!(!session.blocks_idle_offload());
}

#[test]
fn codex_ephemeral_threads_cannot_be_released_for_resume() {
    let session = session();
    assert!(!session.blocks_idle_offload());
    session.config.lock_recover().no_persistence = true;
    assert!(session.blocks_idle_offload());
}
