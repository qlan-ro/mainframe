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
