#[tokio::test(start_paused = true)]
async fn maps_missing_task_type_with_no_captured_tool_use_to_other() {
    let tracker = Arc::new(BackgroundTaskTracker::new());
    let te = ClaudeTaskEvents::new(tracker.clone(), Arc::new(ClaudeWorkflowStore::new()));
    te.handle_task_started("chat-a", started_typed("k2", None), ctx());
    assert_eq!(
        tracker.get("chat-a", "k2").unwrap().kind,
        BackgroundWorkKind::Other
    );
}

// `handle_task_updated`.

#[tokio::test(start_paused = true)]
async fn handle_task_updated_ends_the_task_on_a_terminal_status() {
    let tracker = Arc::new(BackgroundTaskTracker::new());
    let te = ClaudeTaskEvents::new(tracker.clone(), Arc::new(ClaudeWorkflowStore::new()));
    te.handle_task_started("chat-a", started_typed("u1", Some("local_agent")), ctx());
    te.handle_task_updated(
        "chat-a",
        TaskUpdatedPayload {
            task_id: "u1".to_string(),
            status: "completed".to_string(),
        },
        None,
    );
    assert_eq!(
        tracker.get("chat-a", "u1").unwrap().status,
        BackgroundTaskStatus::Completed
    );
}

#[tokio::test(start_paused = true)]
async fn handle_task_updated_ignores_a_non_terminal_status() {
    let tracker = Arc::new(BackgroundTaskTracker::new());
    let te = ClaudeTaskEvents::new(tracker.clone(), Arc::new(ClaudeWorkflowStore::new()));
    te.handle_task_started("chat-a", started_typed("u2", Some("local_agent")), ctx());
    te.handle_task_updated(
        "chat-a",
        TaskUpdatedPayload {
            task_id: "u2".to_string(),
            status: "running".to_string(),
        },
        None,
    );
    assert_eq!(
        tracker.get("chat-a", "u2").unwrap().status,
        BackgroundTaskStatus::Running
    );
}

#[tokio::test(start_paused = true)]
async fn handle_task_updated_ignores_an_unknown_task_id() {
    let tracker = Arc::new(BackgroundTaskTracker::new());
    let te = ClaudeTaskEvents::new(tracker.clone(), Arc::new(ClaudeWorkflowStore::new()));
    te.handle_task_updated(
        "chat-a",
        TaskUpdatedPayload {
            task_id: "ghost".to_string(),
            status: "completed".to_string(),
        },
        None,
    );
    assert!(tracker.get("chat-a", "ghost").is_none());
}

#[tokio::test(start_paused = true)]
async fn threads_deterministic_output_path_into_tracker_start() {
    let tracker = Arc::new(BackgroundTaskTracker::new());
    let te = ClaudeTaskEvents::new(tracker.clone(), Arc::new(ClaudeWorkflowStore::new()));
    te.handle_task_started(
        "chat-a",
        TaskStartedPayload {
            task_id: "tkid01".to_string(),
            tool_use_id: Some("tu1".to_string()),
            description: Some("d".to_string()),
            task_type: None,
            workflow_name: None,
        },
        ctx(),
    );
    let task = tracker.get("chat-a", "tkid01").unwrap();
    assert_eq!(task.id, "tkid01");
    let path = task.output_path.unwrap();
    assert!(path.contains("/claude"));
    assert!(path.ends_with("/-Users-x-proj/sess-uuid/tasks/tkid01.output"));
}
