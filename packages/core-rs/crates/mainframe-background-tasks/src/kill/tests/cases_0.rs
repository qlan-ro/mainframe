use super::*;

#[tokio::test(start_paused = true)]
async fn returns_ok_via_stop_task_when_cli_succeeds() {
    let tracker = BackgroundTaskTracker::new();
    let tk = record_tree_kill(&tracker);
    seed(
        &tracker,
        "c",
        "t1",
        "/tmp/claude-501/-x/sess/tasks/t1.output",
    );
    let session = MockSession {
        result: StopResult {
            ok: true,
            error: None,
        },
        called: Arc::new(Mutex::new(false)),
    };
    let r = kill_background_task(KillArgs {
        chat_id: "c",
        task_id: "t1",
        session: Some(&session),
        tracker: &tracker,
    })
    .await;
    assert_eq!(r, KillResult::Ok { via: Via::StopTask });
    assert!(tk_calls(&tk).is_empty());
}

#[tokio::test(start_paused = true)]
async fn falls_back_to_lsof_and_signal_when_stop_fails_and_writer_exists() {
    let tracker = BackgroundTaskTracker::new();
    set_lsof_queue(&tracker, vec![Canned::Writers(vec![42]), Canned::Empty]);
    let tk = record_tree_kill(&tracker);
    seed(
        &tracker,
        "c",
        "t1",
        "/tmp/claude-501/-x/sess/tasks/t1.output",
    );
    let session = MockSession {
        result: StopResult {
            ok: false,
            error: Some("offline".to_string()),
        },
        called: Arc::new(Mutex::new(false)),
    };
    let r = kill_background_task(KillArgs {
        chat_id: "c",
        task_id: "t1",
        session: Some(&session),
        tracker: &tracker,
    })
    .await;
    let calls = tk_calls(&tk);
    assert!(calls.contains(&(42, Signal::Sigterm)));
    assert!(calls.contains(&(42, Signal::Sigkill)));
    assert_eq!(r, KillResult::Ok { via: Via::Signal });
}

#[tokio::test(start_paused = true)]
async fn reports_failure_when_no_writer_and_stop_failed() {
    let tracker = BackgroundTaskTracker::new();
    set_lsof_queue(&tracker, vec![Canned::Empty]);
    record_tree_kill(&tracker);
    seed(
        &tracker,
        "c",
        "t1",
        "/tmp/claude-501/-x/sess/tasks/t1.output",
    );
    let session = MockSession {
        result: StopResult {
            ok: false,
            error: Some("timeout".to_string()),
        },
        called: Arc::new(Mutex::new(false)),
    };
    let r = kill_background_task(KillArgs {
        chat_id: "c",
        task_id: "t1",
        session: Some(&session),
        tracker: &tracker,
    })
    .await;
    assert_eq!(
        r,
        KillResult::Err {
            error: "timeout".to_string(),
            via: Via::None
        }
    );
}

#[tokio::test(start_paused = true)]
async fn works_without_a_session_goes_straight_to_os_path() {
    let tracker = BackgroundTaskTracker::new();
    set_lsof_queue(&tracker, vec![Canned::Writers(vec![99]), Canned::Empty]);
    let tk = record_tree_kill(&tracker);
    seed(
        &tracker,
        "c",
        "t1",
        "/tmp/claude-501/-x/sess/tasks/t1.output",
    );
    let r = kill_background_task(KillArgs {
        chat_id: "c",
        task_id: "t1",
        session: None,
        tracker: &tracker,
    })
    .await;
    assert!(tk_calls(&tk).contains(&(99, Signal::Sigkill)));
    assert_eq!(r, KillResult::Ok { via: Via::Signal });
}

#[tokio::test(start_paused = true)]
async fn marks_the_task_stopped_after_os_path_success() {
    let tracker = BackgroundTaskTracker::new();
    set_lsof_queue(&tracker, vec![Canned::Writers(vec![99]), Canned::Empty]);
    record_tree_kill(&tracker);
    seed(&tracker, "c", "t1", "/p/t1.out");
    let r = kill_background_task(KillArgs {
        chat_id: "c",
        task_id: "t1",
        session: None,
        tracker: &tracker,
    })
    .await;
    assert_eq!(r, KillResult::Ok { via: Via::Signal });
    let t = tracker.get("c", "t1").unwrap();
    assert_eq!(t.status, BackgroundTaskStatus::Stopped);
    assert_eq!(t.summary.as_deref(), Some("killed via signal"));
    assert_eq!(t.output_path.as_deref(), Some("/p/t1.out"));
}

#[tokio::test(start_paused = true)]
async fn returns_404_style_when_task_not_in_tracker() {
    let tracker = BackgroundTaskTracker::new();
    record_tree_kill(&tracker);
    let session = MockSession {
        result: StopResult {
            ok: true,
            error: None,
        },
        called: Arc::new(Mutex::new(false)),
    };
    let r = kill_background_task(KillArgs {
        chat_id: "c",
        task_id: "ghost",
        session: Some(&session),
        tracker: &tracker,
    })
    .await;
    assert_eq!(
        r,
        KillResult::Err {
            error: "task not found".to_string(),
            via: Via::None
        }
    );
}

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
