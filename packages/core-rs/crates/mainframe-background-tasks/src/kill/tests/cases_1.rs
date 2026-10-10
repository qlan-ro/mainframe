use super::*;

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

#[tokio::test(start_paused = true)]
async fn worktree_sweep_rejects_symlinked_spool_files() {
    let tracker = BackgroundTaskTracker::new();
    let lsof_calls = Arc::new(Mutex::new(0usize));
    let lsof_calls2 = lsof_calls.clone();
    set_exec_for_tests(
        &tracker.process,
        Arc::new(move |_c, _a| {
            *lsof_calls2.lock_recover() += 1;
            Box::pin(async {
                Ok(ExecOk {
                    stdout: String::new(),
                })
            })
        }),
    );
    record_tree_kill(&tracker);
    let fx = build_sweep_fixture(true);
    let out = kill_tasks_for_chat(KillTasksForChatArgs {
        chat_id: "c1",
        worktree_path: Some(&fx.worktree_path),
        session: None,
        tracker: &tracker,
        spool_root: Some(fx.spool_root.clone()),
    })
    .await;
    assert_eq!(*lsof_calls.lock_recover(), 0);
    assert!(out.swept.is_empty());
}

#[tokio::test(start_paused = true)]
async fn worktree_sweep_kills_writer_pids_filters_daemon_pid() {
    let tracker = BackgroundTaskTracker::new();
    let daemon_pid = std::process::id();
    set_lsof_constant(&tracker, vec![999, daemon_pid]);
    let tk = record_tree_kill(&tracker);
    set_ps_comm_for_tests(
        &tracker.process,
        Arc::new(|_pid| Box::pin(async { "ps".to_string() })),
    );
    let fx = build_sweep_fixture(false);
    let out = kill_tasks_for_chat(KillTasksForChatArgs {
        chat_id: "c1",
        worktree_path: Some(&fx.worktree_path),
        session: None,
        tracker: &tracker,
        spool_root: Some(fx.spool_root.clone()),
    })
    .await;
    let calls = tk_calls(&tk);
    assert!(calls.iter().any(|(p, _)| *p == 999));
    assert!(!calls.iter().any(|(p, _)| *p == daemon_pid));
    assert!(out.swept.iter().any(|s| s.pid == 999));
}
