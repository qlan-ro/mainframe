use super::*;

#[tokio::test(start_paused = true)]
async fn cli_path_stop_task_succeeds_transitions_to_stopped() {
    let tracker = BackgroundTaskTracker::new();
    record_tree_kill(&tracker);
    seed(
        &tracker,
        "c1",
        "t1",
        "/tmp/claude-501/-x/sess/tasks/t1.output",
    );
    seed(
        &tracker,
        "c1",
        "t2",
        "/tmp/claude-501/-x/sess/tasks/t2.output",
    );
    let session = MockSession {
        result: StopResult {
            ok: true,
            error: None,
        },
        called: Arc::new(Mutex::new(false)),
    };
    let out = kill_tasks_for_chat(KillTasksForChatArgs {
        chat_id: "c1",
        worktree_path: None,
        session: Some(&session),
        tracker: &tracker,
        spool_root: Some("/tmp/claude-501".to_string()),
    })
    .await;
    let mut killed: Vec<String> = out.killed.iter().map(|k| k.task_id.clone()).collect();
    killed.sort();
    assert_eq!(killed, vec!["t1", "t2"]);
    assert!(out.failed.is_empty());
    assert!(tracker.list_all_running().is_empty());
}

#[tokio::test(start_paused = true)]
async fn os_path_no_session_lsof_writer_kill_succeeds() {
    let tracker = BackgroundTaskTracker::new();
    set_lsof_queue(&tracker, vec![Canned::Writers(vec![321]), Canned::Empty]);
    let tk = record_tree_kill(&tracker);
    seed(
        &tracker,
        "c1",
        "t1",
        "/tmp/claude-501/-x/sess/tasks/t1.output",
    );
    let out = kill_tasks_for_chat(KillTasksForChatArgs {
        chat_id: "c1",
        worktree_path: None,
        session: None,
        tracker: &tracker,
        spool_root: Some("/tmp/claude-501".to_string()),
    })
    .await;
    let calls = tk_calls(&tk);
    assert!(calls.iter().any(|(p, _)| *p == 321));
    assert_eq!(
        out.killed,
        vec![KilledEntry {
            task_id: "t1".to_string(),
            via: Via::Signal
        }]
    );
    assert_eq!(
        tracker.get("c1", "t1").unwrap().status,
        BackgroundTaskStatus::Stopped
    );
}

#[tokio::test(start_paused = true)]
async fn os_path_no_writer_no_session_stays_running_reported_failed() {
    let tracker = BackgroundTaskTracker::new();
    set_lsof_constant(&tracker, vec![]);
    record_tree_kill(&tracker);
    seed(
        &tracker,
        "c1",
        "t1",
        "/tmp/claude-501/-x/sess/tasks/t1.output",
    );
    let out = kill_tasks_for_chat(KillTasksForChatArgs {
        chat_id: "c1",
        worktree_path: None,
        session: None,
        tracker: &tracker,
        spool_root: Some("/tmp/claude-501".to_string()),
    })
    .await;
    assert_eq!(
        out.failed,
        vec![FailedEntry {
            task_id: "t1".to_string(),
            error: "no live writer".to_string()
        }]
    );
    assert_eq!(
        tracker.get("c1", "t1").unwrap().status,
        BackgroundTaskStatus::Running
    );
}
