#[tokio::test(flavor = "multi_thread")]
async fn a_terminal_notification_reconciles_the_on_disk_record() {
    let dir = tempfile::tempdir().unwrap();
    let project_path = dir.path().to_string_lossy().into_owned();
    let _cleanup = write_record(&project_path, "sess-wf-1", "task-9");

    let tracker = Arc::new(BackgroundTaskTracker::new());
    let store = Arc::new(ClaudeWorkflowStore::new());
    let session = session_with_options(
        tracker,
        store.clone(),
        &project_path,
        Some("sess-wf-1".to_string()),
    );
    feed(
        &session,
        json!({ "type": "system", "subtype": "task_started", "task_id": "task-9", "task_type": "local_workflow", "description": "todo lane" }),
    );

    // `spawn_blocking` keeps the dispatch off the async worker while staying in
    // the runtime `spawn_terminal_reconcile` needs; the timeout is the same
    // non-reentrant-mutex guard the tests above use.
    let dispatch = tokio::task::spawn_blocking({
        let session = session.clone();
        move || {
            feed(
                &session,
                json!({ "type": "system", "subtype": "task_notification", "task_id": "task-9", "status": "completed", "summary": "ok" }),
            );
        }
    });
    tokio::time::timeout(Duration::from_secs(1), dispatch)
        .await
        .expect("handle_stdout must not deadlock on ClaudeSessionState")
        .unwrap();

    let run = await_record_source(&store, "task-9").await;
    assert_eq!(run.run_id, Some("run-42".to_string()));
    assert_eq!(run.phases.len(), 1);
    assert_eq!(run.agents.len(), 1);
    assert_eq!(run.status, ClaudeWorkflowRunStatus::Completed);
}
