use super::*;
use std::time::Duration;

#[tokio::test]
async fn skips_tasks_younger_than_grace_ms() {
    let tracker = BackgroundTaskTracker::new();
    let calls = Arc::new(AtomicUsize::new(0));
    let calls2 = calls.clone();
    set_lsof_for_tests(
        &tracker.process,
        Arc::new(move |_path| {
            calls2.fetch_add(1, Ordering::SeqCst);
            Box::pin(async { Ok(String::new()) })
        }),
    );
    seed_running(&tracker, "c1", "t1", "/p/t1.out");
    let mut miss = Suspects::new();
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
    set_lsof_for_tests(&tracker.process, writers_lsof(&[]));
    seed_running(&tracker, "c1", "t1", "/p/t1.out");
    let task_start = tracker.get("c1", "t1").unwrap().started_at;
    let mut miss = Suspects::new();
    run_liveness_sweep(&tracker, &mut miss, task_start + 100_000, false).await;
    assert_eq!(
        tracker.get("c1", "t1").unwrap().status,
        BackgroundTaskStatus::Running
    );
    assert!(miss.contains(&("c1".to_string(), "t1".to_string())));
}

#[tokio::test]
async fn two_strike_second_empty_ends() {
    let tracker = BackgroundTaskTracker::new();
    set_lsof_for_tests(&tracker.process, writers_lsof(&[]));
    seed_running(&tracker, "c1", "t1", "/p/t1.out");
    let task_start = tracker.get("c1", "t1").unwrap().started_at;
    let mut miss = Suspects::new();
    run_liveness_sweep(&tracker, &mut miss, task_start + 100_000, false).await;
    run_liveness_sweep(&tracker, &mut miss, task_start + 160_000, false).await;
    let t = tracker.get("c1", "t1").unwrap();
    assert_eq!(t.status, BackgroundTaskStatus::Stopped);
    assert_eq!(t.summary.as_deref(), Some("process gone (liveness sweep)"));
}

#[tokio::test]
async fn wake_mode_one_empty_observation_suffices() {
    let tracker = BackgroundTaskTracker::new();
    set_lsof_for_tests(&tracker.process, writers_lsof(&[]));
    seed_running(&tracker, "c1", "t1", "/p/t1.out");
    let task_start = tracker.get("c1", "t1").unwrap().started_at;
    let mut miss = Suspects::new();
    run_liveness_sweep(&tracker, &mut miss, task_start + 100_000, true).await;
    assert_eq!(
        tracker.get("c1", "t1").unwrap().status,
        BackgroundTaskStatus::Stopped
    );
}

#[tokio::test]
async fn lsof_error_causes_no_status_change() {
    let tracker = BackgroundTaskTracker::new();
    set_lsof_for_tests(
        &tracker.process,
        Arc::new(|_path| Box::pin(async { Err(crate::lsof::LsofError::NotInstalled) })),
    );
    seed_running(&tracker, "c1", "t1", "/p/t1.out");
    let task_start = tracker.get("c1", "t1").unwrap().started_at;
    let mut miss = Suspects::new();
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
    let mut miss = Suspects::new();

    set_lsof_for_tests(&tracker.process, writers_lsof(&[]));
    run_liveness_sweep(&tracker, &mut miss, task_start + 100_000, false).await;
    assert!(miss.contains(&("c1".to_string(), "t1".to_string())));

    set_lsof_for_tests(&tracker.process, writers_lsof(&[555]));
    run_liveness_sweep(&tracker, &mut miss, task_start + 160_000, false).await;
    assert!(miss.is_empty());
    assert_eq!(tracker.get_pid("c1", "t1"), Some(555));
}

#[tokio::test]
async fn non_bash_kinds_are_exempt_from_lsof_probe_and_sweep() {
    let tracker = BackgroundTaskTracker::new();
    let calls = Arc::new(AtomicUsize::new(0));
    let calls2 = calls.clone();
    set_lsof_for_tests(
        &tracker.process,
        Arc::new(move |_path| {
            calls2.fetch_add(1, Ordering::SeqCst);
            Box::pin(async { Ok(String::new()) })
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
    let mut miss = Suspects::new();
    run_liveness_sweep(&tracker, &mut miss, task_start + 100_000, true).await;
    assert_eq!(calls.load(Ordering::SeqCst), 0);
    assert_eq!(
        tracker.get("c1", "a1").unwrap().status,
        BackgroundTaskStatus::Running
    );
}

#[test]
fn is_wake_thresholds() {
    assert!(!is_wake(60_000, PERIOD)); // one period
    assert!(!is_wake(120_000, PERIOD)); // exactly two periods is not a wake
    assert!(is_wake(120_001, PERIOD));
    assert!(is_wake(7 * 3600 * 1000, PERIOD)); // seven-hour sleep
}

#[tokio::test]
async fn wallclock_jump_triggers_wake_mode_end() {
    let tracker = BackgroundTaskTracker::new();
    set_lsof_for_tests(&tracker.process, writers_lsof(&[]));
    let start = now_ms();
    seed_running(&tracker, "c1", "t1", "/p/t1.out");
    // Make the task look old enough to be eligible immediately.
    let mut old = tracker.get("c1", "t1").unwrap();
    old.started_at = start - 200_000;
    tracker.adopt("c1", old);
    let mut miss = Suspects::new();

    // First tick at +60s: normal mode → one miss, task stays running.
    let now1 = start + 60_000;
    run_liveness_sweep(&tracker, &mut miss, now1, is_wake(now1 - start, PERIOD)).await;
    assert_eq!(
        tracker.get("c1", "t1").unwrap().status,
        BackgroundTaskStatus::Running
    );

    // Jump 7 hours forward: next tick is treated as a wake.
    let now2 = start + 60_000 + 7 * 3600 * 1000;
    run_liveness_sweep(&tracker, &mut miss, now2, is_wake(now2 - now1, PERIOD)).await;
    assert_eq!(
        tracker.get("c1", "t1").unwrap().status,
        BackgroundTaskStatus::Stopped
    );
}

/// Counts lsof probes against one old running bash task, so each sweep is
/// observable. Returns the probe counter and a notifier fired per probe.
fn observable_tracker() -> (
    Arc<BackgroundTaskTracker>,
    Arc<AtomicUsize>,
    Arc<tokio::sync::Notify>,
) {
    let tracker = Arc::new(BackgroundTaskTracker::new());
    let calls = Arc::new(AtomicUsize::new(0));
    let ticked = Arc::new(tokio::sync::Notify::new());
    let (calls2, notify) = (calls.clone(), ticked.clone());
    set_lsof_for_tests(
        &tracker.process,
        Arc::new(move |_path| {
            calls2.fetch_add(1, Ordering::SeqCst);
            notify.notify_one();
            Box::pin(async { Ok(String::new()) })
        }),
    );
    seed_running(&tracker, "c1", "t1", "/p/t1.out");
    let mut old = tracker.get("c1", "t1").unwrap();
    old.started_at = now_ms() - 200_000;
    tracker.adopt("c1", old);
    (tracker, calls, ticked)
}

async fn assert_no_ticks_after(calls: &AtomicUsize) {
    let after_stop = calls.load(Ordering::SeqCst);
    assert!(
        after_stop >= 1,
        "scheduler should have ticked at least once"
    );
    tokio::time::advance(Duration::from_millis(60)).await;
    tokio::task::yield_now().await;
    assert_eq!(calls.load(Ordering::SeqCst), after_stop);
}

#[tokio::test(start_paused = true)]
async fn stop_prevents_further_ticks() {
    let (tracker, calls, ticked) = observable_tracker();
    let sched = start_liveness_scheduler_every(tracker, Duration::from_millis(20));
    ticked.notified().await;
    sched.stop();
    assert_no_ticks_after(&calls).await;
}

#[tokio::test(start_paused = true)]
async fn dropping_the_handle_prevents_further_ticks() {
    let (tracker, calls, ticked) = observable_tracker();
    let sched = start_liveness_scheduler_every(tracker, Duration::from_millis(20));
    ticked.notified().await;
    drop(sched);
    assert_no_ticks_after(&calls).await;
}
