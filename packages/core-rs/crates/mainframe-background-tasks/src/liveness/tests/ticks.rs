use super::*;

#[tokio::test]
async fn skips_tasks_younger_than_grace_ms() {
    let tracker = BackgroundTaskTracker::new();
    let calls = Arc::new(AtomicUsize::new(0));
    let calls2 = calls.clone();
    set_exec_for_tests(
        &tracker.process,
        Arc::new(move |_c, _a| {
            calls2.fetch_add(1, Ordering::SeqCst);
            Box::pin(async {
                Ok(ExecOk {
                    stdout: String::new(),
                })
            })
        }),
    );
    seed_running(&tracker, "c1", "t1", "/p/t1.out");
    let mut miss = MissMap::new();
    run_liveness_sweep(&tracker, &mut miss, now_ms(), false).await;
    assert_eq!(calls.load(Ordering::SeqCst), 0);
    assert_eq!(
        tracker.get("c1", "t1").unwrap().status,
        BackgroundTaskStatus::Running
    );
}

#[tokio::test]
async fn two_strike_first_empty_does_not_end() {
    let tracker = BackgroundTaskTracker::new();
    set_exec_for_tests(&tracker.process, writers_exec(&[]));
    seed_running(&tracker, "c1", "t1", "/p/t1.out");
    let task_start = tracker.get("c1", "t1").unwrap().started_at;
    let mut miss = MissMap::new();
    run_liveness_sweep(&tracker, &mut miss, task_start + 100_000, false).await;
    assert_eq!(
        tracker.get("c1", "t1").unwrap().status,
        BackgroundTaskStatus::Running
    );
    assert_eq!(get_miss_count(&miss, "c1", "t1"), 1);
}

#[tokio::test]
async fn two_strike_second_empty_ends() {
    let tracker = BackgroundTaskTracker::new();
    set_exec_for_tests(&tracker.process, writers_exec(&[]));
    seed_running(&tracker, "c1", "t1", "/p/t1.out");
    let task_start = tracker.get("c1", "t1").unwrap().started_at;
    let mut miss = MissMap::new();
    run_liveness_sweep(&tracker, &mut miss, task_start + 100_000, false).await;
    run_liveness_sweep(&tracker, &mut miss, task_start + 160_000, false).await;
    let t = tracker.get("c1", "t1").unwrap();
    assert_eq!(t.status, BackgroundTaskStatus::Stopped);
    assert_eq!(t.summary.as_deref(), Some("process gone (liveness sweep)"));
}

#[tokio::test]
async fn wake_mode_one_empty_observation_suffices() {
    let tracker = BackgroundTaskTracker::new();
    set_exec_for_tests(&tracker.process, writers_exec(&[]));
    seed_running(&tracker, "c1", "t1", "/p/t1.out");
    let task_start = tracker.get("c1", "t1").unwrap().started_at;
    let mut miss = MissMap::new();
    run_liveness_sweep(&tracker, &mut miss, task_start + 100_000, true).await;
    assert_eq!(
        tracker.get("c1", "t1").unwrap().status,
        BackgroundTaskStatus::Stopped
    );
}

#[tokio::test]
async fn lsof_error_causes_no_status_change() {
    let tracker = BackgroundTaskTracker::new();
    set_exec_for_tests(
        &tracker.process,
        Arc::new(|_c, _a| {
            Box::pin(async {
                Err(crate::lsof::LsofExecError {
                    code: Some(crate::lsof::ExecCode::Text("ENOENT".to_string())),
                    signal: None,
                    stdout: None,
                })
            })
        }),
    );
    seed_running(&tracker, "c1", "t1", "/p/t1.out");
    let task_start = tracker.get("c1", "t1").unwrap().started_at;
    let mut miss = MissMap::new();
    run_liveness_sweep(&tracker, &mut miss, task_start + 100_000, true).await;
    run_liveness_sweep(&tracker, &mut miss, task_start + 160_000, true).await;
    assert_eq!(
        tracker.get("c1", "t1").unwrap().status,
        BackgroundTaskStatus::Running
    );
    assert_eq!(miss.len(), 0);
}

#[tokio::test]
async fn live_writer_found_resets_miss_and_refreshes_pid() {
    let tracker = BackgroundTaskTracker::new();
    seed_running(&tracker, "c1", "t1", "/p/t1.out");
    let task_start = tracker.get("c1", "t1").unwrap().started_at;
    let mut miss = MissMap::new();

    set_exec_for_tests(&tracker.process, writers_exec(&[]));
    run_liveness_sweep(&tracker, &mut miss, task_start + 100_000, false).await;
    assert_eq!(get_miss_count(&miss, "c1", "t1"), 1);

    set_exec_for_tests(&tracker.process, writers_exec(&[555]));
    run_liveness_sweep(&tracker, &mut miss, task_start + 160_000, false).await;
    assert_eq!(get_miss_count(&miss, "c1", "t1"), 0);
    assert_eq!(tracker.get_pid("c1", "t1"), Some(555));
}

#[tokio::test]
async fn non_bash_kinds_are_exempt_from_lsof_probe_and_sweep() {
    let tracker = BackgroundTaskTracker::new();
    let calls = Arc::new(AtomicUsize::new(0));
    let calls2 = calls.clone();
    set_exec_for_tests(
        &tracker.process,
        Arc::new(move |_c, _a| {
            calls2.fetch_add(1, Ordering::SeqCst);
            Box::pin(async {
                Ok(ExecOk {
                    stdout: String::new(),
                })
            })
        }),
    );
    tracker.start(
        "c1",
        TaskSeed {
            id: "a1".to_string(),
            kind: BackgroundWorkKind::Agent,
            tool_name: BackgroundTaskToolName::Bash,
            tool_use_id: "u".to_string(),
            command: String::new(),
            description: "subagent".to_string(),
            workflow_name: None,
        },
        "/p/a1.out".to_string(),
    );
    let task_start = tracker.get("c1", "a1").unwrap().started_at;
    let mut miss = MissMap::new();
    run_liveness_sweep(&tracker, &mut miss, task_start + 100_000, true).await;
    assert_eq!(calls.load(Ordering::SeqCst), 0);
    assert_eq!(
        tracker.get("c1", "a1").unwrap().status,
        BackgroundTaskStatus::Running
    );
}

#[test]
fn is_wake_thresholds() {
    assert!(!is_wake(60_000, 60_000)); // 1× interval
    assert!(!is_wake(120_000, 60_000)); // exactly 2× is NOT a wake (strict >)
    assert!(is_wake(7 * 3600 * 1000, 60_000)); // 7h jump
}

#[tokio::test]
async fn wallclock_jump_triggers_wake_mode_end() {
    let tracker = BackgroundTaskTracker::new();
    set_exec_for_tests(&tracker.process, writers_exec(&[]));
    let start = now_ms();
    seed_running(&tracker, "c1", "t1", "/p/t1.out");
    // Make the task look old enough to be eligible immediately.
    let mut old = tracker.get("c1", "t1").unwrap();
    old.started_at = start - 200_000;
    tracker.adopt("c1", old, crate::tracker::AdoptOptions::default());
    let mut miss = MissMap::new();

    // First tick at +60s: normal mode → one miss, task stays running.
    let now1 = start + 60_000;
    run_liveness_sweep(&tracker, &mut miss, now1, is_wake(now1 - start, 60_000)).await;
    assert_eq!(
        tracker.get("c1", "t1").unwrap().status,
        BackgroundTaskStatus::Running
    );

    // Jump 7 hours forward: next tick is treated as a wake.
    let now2 = start + 60_000 + 7 * 3600 * 1000;
    run_liveness_sweep(&tracker, &mut miss, now2, is_wake(now2 - now1, 60_000)).await;
    assert_eq!(
        tracker.get("c1", "t1").unwrap().status,
        BackgroundTaskStatus::Stopped
    );
}

#[tokio::test]
async fn stop_prevents_further_ticks() {
    let tracker = Arc::new(BackgroundTaskTracker::new());
    let calls = Arc::new(AtomicUsize::new(0));
    let calls2 = calls.clone();
    set_exec_for_tests(
        &tracker.process,
        Arc::new(move |_c, _a| {
            calls2.fetch_add(1, Ordering::SeqCst);
            Box::pin(async {
                Ok(ExecOk {
                    stdout: String::new(),
                })
            })
        }),
    );
    // Old running task so each tick issues an lsof (observable).
    seed_running(&tracker, "c1", "t1", "/p/t1.out");
    let mut old = tracker.get("c1", "t1").unwrap();
    old.started_at = now_ms() - 200_000;
    tracker.adopt("c1", old, crate::tracker::AdoptOptions::default());

    let sched = start_liveness_scheduler(LivenessDeps {
        tracker: tracker.clone(),
        interval_ms: Some(20),
    });
    tokio::time::sleep(std::time::Duration::from_millis(70)).await;
    sched.stop();
    let after_stop = calls.load(Ordering::SeqCst);
    assert!(
        after_stop >= 1,
        "scheduler should have ticked at least once"
    );
    tokio::time::sleep(std::time::Duration::from_millis(60)).await;
    assert_eq!(
        calls.load(Ordering::SeqCst),
        after_stop,
        "stop() must halt further ticks"
    );
}
