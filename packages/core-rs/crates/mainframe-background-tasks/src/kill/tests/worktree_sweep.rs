use super::*;

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

/// A sweep whose tree signals fail for a descendant, and for the writer
/// itself when `root_failed`.
async fn sweep_with_tree_kill_failure(root_failed: bool) -> KillTasksForChatResult {
    let tracker = BackgroundTaskTracker::new();
    set_lsof_constant(&tracker, vec![999]);
    set_tree_kill_for_tests(
        &tracker.process,
        Arc::new(move |_pid, _signal| {
            Box::pin(async move {
                Err(os::TreeKillError {
                    root_failed,
                    detail: "pid 1001: Operation not permitted".to_string(),
                })
            })
        }),
    );
    set_ps_comm_for_tests(
        &tracker.process,
        Arc::new(|_pid| Box::pin(async { "node".to_string() })),
    );
    let fx = build_sweep_fixture(false);
    kill_tasks_for_chat(KillTasksForChatArgs {
        chat_id: "c1",
        worktree_path: Some(&fx.worktree_path),
        session: None,
        tracker: &tracker,
        spool_root: Some(fx.spool_root.clone()),
    })
    .await
}

#[tokio::test(start_paused = true)]
async fn worktree_sweep_counts_a_killed_writer_whose_descendant_refused_the_signal() {
    let out = sweep_with_tree_kill_failure(false).await;
    let swept: Vec<_> = out
        .swept
        .iter()
        .map(|s| (s.pid, s.command.as_str()))
        .collect();
    assert_eq!(swept, vec![(999, "node")]);
}

#[tokio::test(start_paused = true)]
async fn worktree_sweep_does_not_count_a_writer_it_could_not_signal() {
    let out = sweep_with_tree_kill_failure(true).await;
    assert!(out.swept.is_empty());
}
