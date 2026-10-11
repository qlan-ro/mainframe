use super::*;
use mainframe_types::background_task::BackgroundTaskStatus;

const SESS: &str = "sess-uuid";
const CWD: &str = "/Users/x/proj";

fn ctx() -> TaskStartedCtx {
    TaskStartedCtx {
        vendor_session_id: SESS.to_string(),
        real_cwd: CWD.to_string(),
    }
}

fn started(task_id: &str, tool_use_id: &str, description: &str) -> TaskStartedPayload {
    TaskStartedPayload {
        task_id: task_id.to_string(),
        tool_use_id: Some(tool_use_id.to_string()),
        description: Some(description.to_string()),
        task_type: None,
        workflow_name: None,
    }
}

#[tokio::test(start_paused = true)]
async fn captures_bash_run_in_background_into_metadata_cache() {
    let tracker = Arc::new(BackgroundTaskTracker::new());
    let te = ClaudeTaskEvents::new(tracker.clone(), Arc::new(ClaudeWorkflowStore::new()));
    te.capture_tool_use(
        "tu-1",
        "Bash",
        Some(&serde_json::json!({ "command": "pnpm dev", "description": "dev", "run_in_background": true })),
    );
    te.handle_task_started("chat-a", started("t-1", "tu-1", "dev"), ctx());
    let task = tracker.get("chat-a", "t-1").unwrap();
    assert_eq!(task.tool_name, BackgroundTaskToolName::Bash);
    assert_eq!(task.command, "pnpm dev");
    assert_eq!(task.description, "dev");
}

#[tokio::test(start_paused = true)]
async fn captures_monitor_tool_use() {
    let tracker = Arc::new(BackgroundTaskTracker::new());
    let te = ClaudeTaskEvents::new(tracker.clone(), Arc::new(ClaudeWorkflowStore::new()));
    te.capture_tool_use(
        "tu-2",
        "Monitor",
        Some(&serde_json::json!({ "command": "tail -f /tmp/log", "description": "log tail" })),
    );
    te.handle_task_started("chat-a", started("t-2", "tu-2", "log tail"), ctx());
    assert_eq!(
        tracker.get("chat-a", "t-2").unwrap().tool_name,
        BackgroundTaskToolName::Monitor
    );
}

#[tokio::test(start_paused = true)]
async fn ignores_non_background_bash() {
    let tracker = Arc::new(BackgroundTaskTracker::new());
    let te = ClaudeTaskEvents::new(tracker.clone(), Arc::new(ClaudeWorkflowStore::new()));
    te.capture_tool_use(
        "tu-x",
        "Bash",
        Some(&serde_json::json!({ "command": "ls" })),
    );
    te.handle_task_started("chat-a", started("t-x", "tu-x", "ls listing"), ctx());
    let task = tracker.get("chat-a", "t-x").unwrap();
    assert_eq!(task.tool_name, BackgroundTaskToolName::Bash);
    assert_eq!(task.command, "ls listing");
}

#[tokio::test(start_paused = true)]
async fn evicts_metadata_cache_after_60s_ttl() {
    let tracker = Arc::new(BackgroundTaskTracker::new());
    let te = ClaudeTaskEvents::new(tracker.clone(), Arc::new(ClaudeWorkflowStore::new()));
    te.capture_tool_use(
        "tu-3",
        "Bash",
        Some(&serde_json::json!({ "command": "sleep 5", "run_in_background": true })),
    );
    // Let the spawned eviction task register its 60s sleep before advancing.
    tokio::task::yield_now().await;
    tokio::time::advance(Duration::from_millis(60_001)).await;
    tokio::task::yield_now().await;
    te.handle_task_started("chat-a", started("t-3", "tu-3", "sleeper"), ctx());
    let task = tracker.get("chat-a", "t-3").unwrap();
    assert_eq!(task.tool_name, BackgroundTaskToolName::Bash);
    assert_eq!(task.command, "sleeper");
}

#[tokio::test(start_paused = true)]
async fn handles_task_notification_with_all_fields() {
    let tracker = Arc::new(BackgroundTaskTracker::new());
    let te = ClaudeTaskEvents::new(tracker.clone(), Arc::new(ClaudeWorkflowStore::new()));
    te.capture_tool_use(
        "tu-4",
        "Bash",
        Some(&serde_json::json!({ "command": "gulp build", "run_in_background": true })),
    );
    te.handle_task_started("chat-a", started("t-4", "tu-4", "build"), ctx());
    te.handle_task_notification(
        "chat-a",
        TaskNotificationPayload {
            task_id: "t-4".to_string(),
            status: "completed".to_string(),
            output_file: Some("/tmp/claude-501/p/s/tasks/t-4.output".to_string()),
            summary: Some("ok".to_string()),
            usage: Some(TaskNotificationUsage {
                total_tokens: 100,
                tool_uses: 1,
                duration_ms: 500,
            }),
        },
        None,
    );
    let task = tracker.get("chat-a", "t-4").unwrap();
    assert_eq!(task.status, BackgroundTaskStatus::Completed);
    assert_eq!(
        task.output_path.as_deref(),
        Some("/tmp/claude-501/p/s/tasks/t-4.output")
    );
    assert_eq!(task.summary.as_deref(), Some("ok"));
}

#[tokio::test(start_paused = true)]
async fn normalizes_empty_output_file_preserving_start_path() {
    let tracker = Arc::new(BackgroundTaskTracker::new());
    let te = ClaudeTaskEvents::new(tracker.clone(), Arc::new(ClaudeWorkflowStore::new()));
    te.capture_tool_use(
        "tu-5",
        "Bash",
        Some(&serde_json::json!({ "command": "pnpm dev", "run_in_background": true })),
    );
    te.handle_task_started("chat-a", started("t-5", "tu-5", "dev"), ctx());
    let started_path = tracker.get("chat-a", "t-5").unwrap().output_path.unwrap();
    assert!(started_path.ends_with("t-5.output"));
    te.handle_task_notification(
        "chat-a",
        TaskNotificationPayload {
            task_id: "t-5".to_string(),
            status: "stopped".to_string(),
            output_file: Some(String::new()),
            summary: Some("killed".to_string()),
            usage: None,
        },
        None,
    );
    assert_eq!(
        tracker.get("chat-a", "t-5").unwrap().output_path,
        Some(started_path)
    );
}

#[tokio::test(start_paused = true)]
async fn maps_unknown_status_to_stopped() {
    let tracker = Arc::new(BackgroundTaskTracker::new());
    let te = ClaudeTaskEvents::new(tracker.clone(), Arc::new(ClaudeWorkflowStore::new()));
    te.capture_tool_use(
        "tu-6",
        "Bash",
        Some(&serde_json::json!({ "command": "x", "run_in_background": true })),
    );
    te.handle_task_started("chat-a", started("t-6", "tu-6", "x"), ctx());
    te.handle_task_notification(
        "chat-a",
        TaskNotificationPayload {
            task_id: "t-6".to_string(),
            status: "aborted".to_string(),
            output_file: Some(String::new()),
            summary: Some(String::new()),
            usage: None,
        },
        None,
    );
    assert_eq!(
        tracker.get("chat-a", "t-6").unwrap().status,
        BackgroundTaskStatus::Stopped
    );
}

fn started_typed(task_id: &str, task_type: Option<&str>) -> TaskStartedPayload {
    TaskStartedPayload {
        task_id: task_id.to_string(),
        tool_use_id: None,
        description: Some("x".to_string()),
        task_type: task_type.map(str::to_string),
        workflow_name: None,
    }
}

// Background work kind mapping.

#[tokio::test(start_paused = true)]
async fn maps_local_bash_to_bash() {
    let tracker = Arc::new(BackgroundTaskTracker::new());
    let te = ClaudeTaskEvents::new(tracker.clone(), Arc::new(ClaudeWorkflowStore::new()));
    te.handle_task_started("chat-a", started_typed("b1", Some("local_bash")), ctx());
    assert_eq!(
        tracker.get("chat-a", "b1").unwrap().kind,
        BackgroundWorkKind::Bash
    );
}

#[tokio::test(start_paused = true)]
async fn maps_local_agent_to_agent() {
    let tracker = Arc::new(BackgroundTaskTracker::new());
    let te = ClaudeTaskEvents::new(tracker.clone(), Arc::new(ClaudeWorkflowStore::new()));
    te.handle_task_started("chat-a", started_typed("a1", Some("local_agent")), ctx());
    assert_eq!(
        tracker.get("chat-a", "a1").unwrap().kind,
        BackgroundWorkKind::Agent
    );
}

#[tokio::test(start_paused = true)]
async fn maps_remote_agents_and_teammates_to_agent() {
    let tracker = Arc::new(BackgroundTaskTracker::new());
    let te = ClaudeTaskEvents::new(tracker.clone(), Arc::new(ClaudeWorkflowStore::new()));
    te.handle_task_started("chat-a", started_typed("a2", Some("remote_agent")), ctx());
    te.handle_task_started("chat-a", started_typed("a3", Some("teammate")), ctx());
    assert_eq!(
        tracker.get("chat-a", "a2").unwrap().kind,
        BackgroundWorkKind::Agent
    );
    assert_eq!(
        tracker.get("chat-a", "a3").unwrap().kind,
        BackgroundWorkKind::Agent
    );
}

#[tokio::test(start_paused = true)]
async fn maps_local_workflow_to_workflow() {
    let tracker = Arc::new(BackgroundTaskTracker::new());
    let te = ClaudeTaskEvents::new(tracker.clone(), Arc::new(ClaudeWorkflowStore::new()));
    te.handle_task_started("chat-a", started_typed("w1", Some("local_workflow")), ctx());
    assert_eq!(
        tracker.get("chat-a", "w1").unwrap().kind,
        BackgroundWorkKind::Workflow
    );
}

#[tokio::test(start_paused = true)]
async fn maps_unknown_task_type_to_other() {
    let tracker = Arc::new(BackgroundTaskTracker::new());
    let te = ClaudeTaskEvents::new(tracker.clone(), Arc::new(ClaudeWorkflowStore::new()));
    te.handle_task_started("chat-a", started_typed("o1", Some("local_quantum")), ctx());
    assert_eq!(
        tracker.get("chat-a", "o1").unwrap().kind,
        BackgroundWorkKind::Other
    );
}

#[tokio::test(start_paused = true)]
async fn falls_back_to_bash_when_task_type_missing_but_bash_tool_use_captured() {
    let tracker = Arc::new(BackgroundTaskTracker::new());
    let te = ClaudeTaskEvents::new(tracker.clone(), Arc::new(ClaudeWorkflowStore::new()));
    te.capture_tool_use(
        "tu-k",
        "Bash",
        Some(&serde_json::json!({ "command": "pnpm dev", "run_in_background": true })),
    );
    te.handle_task_started(
        "chat-a",
        TaskStartedPayload {
            task_id: "k1".to_string(),
            tool_use_id: Some("tu-k".to_string()),
            description: Some("dev".to_string()),
            task_type: None,
            workflow_name: None,
        },
        ctx(),
    );
    assert_eq!(
        tracker.get("chat-a", "k1").unwrap().kind,
        BackgroundWorkKind::Bash
    );
}
