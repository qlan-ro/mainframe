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
    assert_eq!(r, Ok(Via::StopTask));
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
    assert_eq!(r, Ok(Via::Signal));
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
        Err(KillError::Unreachable {
            stop_error: Some("timeout".to_string())
        })
    );
    assert_eq!(r.unwrap_err().to_string(), "timeout");
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
    assert_eq!(r, Ok(Via::Signal));
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
    assert_eq!(r, Ok(Via::Signal));
    let t = tracker.get("c", "t1").unwrap();
    assert_eq!(t.status, BackgroundTaskStatus::Stopped);
    assert_eq!(t.summary.as_deref(), Some("killed via signal"));
    assert_eq!(t.output_path.as_deref(), Some("/p/t1.out"));
}

#[tokio::test(start_paused = true)]
async fn reports_not_found_for_an_unknown_task() {
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
    assert_eq!(r, Err(KillError::NotFound));
}

#[tokio::test(start_paused = true)]
async fn reports_survivors_when_a_writer_outlives_the_signals() {
    let tracker = BackgroundTaskTracker::new();
    set_lsof_queue(
        &tracker,
        vec![Canned::Writers(vec![42]), Canned::Writers(vec![42])],
    );
    record_tree_kill(&tracker);
    seed(&tracker, "c", "t1", "/p/t1.output");
    let r = kill_background_task(KillArgs {
        chat_id: "c",
        task_id: "t1",
        session: None,
        tracker: &tracker,
    })
    .await;
    assert_eq!(r, Err(KillError::Survivors { pids: vec![42] }));
    assert_eq!(r.unwrap_err().to_string(), "pids still alive: 42");
    assert_eq!(
        tracker.get("c", "t1").unwrap().status,
        BackgroundTaskStatus::Running
    );
}

#[tokio::test(start_paused = true)]
async fn a_task_without_an_output_path_is_unreachable_once_the_session_refuses() {
    let tracker = BackgroundTaskTracker::new();
    record_tree_kill(&tracker);
    let mut task = tracker.start(
        "c",
        TaskSeed {
            id: "t1".to_string(),
            kind: BackgroundWorkKind::Agent,
            tool_name: BackgroundTaskToolName::Bash,
            tool_use_id: "u".to_string(),
            command: String::new(),
            description: String::new(),
            workflow_name: None,
        },
        String::new(),
    );
    task.output_path = None;
    tracker.adopt("c", task);
    let session = MockSession {
        result: StopResult {
            ok: false,
            error: Some("denied".to_string()),
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
        Err(KillError::Unreachable {
            stop_error: Some("denied".to_string())
        })
    );
}
