//! Ported from `packages/core/src/background-tasks/liveness.ts`.

use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use tokio::task::JoinHandle;

use mainframe_types::background_task::BackgroundTaskStatus;

use crate::lsof::lsof_writers_detailed;
use crate::tracker::{BackgroundTaskTracker, TerminalUpdate};

pub const TICK_MS: u64 = 60_000;
pub const GRACE_MS: i64 = 90_000;
pub const WAKE_DELTA_MULT: i64 = 2;

/// chatId → taskId → miss count.
pub type MissMap = HashMap<String, HashMap<String, i64>>;

pub struct LivenessDeps {
    pub tracker: Arc<BackgroundTaskTracker>,
    pub interval_ms: Option<u64>,
}

pub struct LivenessSchedulerHandle {
    handle: JoinHandle<()>,
}

impl LivenessSchedulerHandle {
    pub fn stop(&self) {
        self.handle.abort();
    }
}

/// Read the current miss count for `(chatId, taskId)`. Exported for tests.
pub fn get_miss_count(miss_map: &MissMap, chat_id: &str, task_id: &str) -> i64 {
    miss_map
        .get(chat_id)
        .and_then(|inner| inner.get(task_id))
        .copied()
        .unwrap_or(0)
}

fn set_miss(miss_map: &mut MissMap, chat_id: &str, task_id: &str, count: i64) {
    miss_map
        .entry(chat_id.to_string())
        .or_default()
        .insert(task_id.to_string(), count);
}

fn delete_miss(miss_map: &mut MissMap, chat_id: &str, task_id: &str) {
    if let Some(inner) = miss_map.get_mut(chat_id) {
        inner.remove(task_id);
        if inner.is_empty() {
            miss_map.remove(chat_id);
        }
    }
}

/// `delta > intervalMs * WAKE_DELTA_MULT` — the wallclock-jump wake heuristic.
pub(crate) fn is_wake(delta: i64, interval_ms: u64) -> bool {
    delta > interval_ms as i64 * WAKE_DELTA_MULT
}

/// One-shot sweep. Exported for direct testing.
pub async fn run_liveness_sweep(
    tracker: &BackgroundTaskTracker,
    miss_map: &mut MissMap,
    now: i64,
    force_wake: bool,
) {
    let mut live_by_chat: HashMap<String, HashSet<String>> = HashMap::new();
    for (chat_id, task) in tracker.list_all_running() {
        live_by_chat
            .entry(chat_id.clone())
            .or_default()
            .insert(task.id.clone());

        if now - task.started_at < GRACE_MS {
            continue;
        }
        let Some(output_path) = task.output_path.clone() else {
            tracing::warn!(target: "background-tasks:liveness", chat_id = %chat_id, task_id = %task.id, "liveness skip: no outputPath");
            continue;
        };
        let pids = match lsof_writers_detailed(&output_path).await {
            // Skip: don't mass-mark stopped on lsof failure.
            Err(_) => continue,
            Ok(pids) => pids,
        };
        if !pids.is_empty() {
            delete_miss(miss_map, &chat_id, &task.id);
            tracker.set_pid(&chat_id, &task.id, pids[0]);
            continue;
        }
        // Empty observation
        let prev = get_miss_count(miss_map, &chat_id, &task.id);
        if force_wake || prev >= 1 {
            delete_miss(miss_map, &chat_id, &task.id);
            tracker.end(
                &chat_id,
                &task.id,
                TerminalUpdate {
                    status: BackgroundTaskStatus::Stopped,
                    output_path,
                    summary: "process gone (liveness sweep)".to_string(),
                    usage: None,
                },
            );
        } else {
            set_miss(miss_map, &chat_id, &task.id, prev + 1);
        }
    }
    // GC chats no longer tracked; tasks no longer running.
    let chat_ids: Vec<String> = miss_map.keys().cloned().collect();
    for chat_id in chat_ids {
        let Some(live) = live_by_chat.get(&chat_id) else {
            miss_map.remove(&chat_id);
            continue;
        };
        if let Some(inner) = miss_map.get_mut(&chat_id) {
            let task_ids: Vec<String> = inner.keys().cloned().collect();
            for task_id in task_ids {
                if !live.contains(&task_id) {
                    inner.remove(&task_id);
                }
            }
            if inner.is_empty() {
                miss_map.remove(&chat_id);
            }
        }
    }
}

type Clock = Arc<dyn Fn() -> i64 + Send + Sync>;

pub fn start_liveness_scheduler(deps: LivenessDeps) -> LivenessSchedulerHandle {
    let clock: Clock = Arc::new(|| chrono::Utc::now().timestamp_millis());
    start_liveness_scheduler_with_clock(deps, clock)
}

/// Clock-injectable variant — the wall-clock source (`Date.now()`) is a closure
/// so wake-detection can be driven deterministically in tests.
pub(crate) fn start_liveness_scheduler_with_clock(
    deps: LivenessDeps,
    clock: Clock,
) -> LivenessSchedulerHandle {
    let interval_ms = deps.interval_ms.unwrap_or(TICK_MS);
    let tracker = deps.tracker;
    let handle = tokio::spawn(async move {
        let mut miss_map: MissMap = HashMap::new();
        let mut last_tick = clock();
        let period = std::time::Duration::from_millis(interval_ms);
        // `interval_at(now + period, ...)` so the first tick fires AFTER the
        // interval, matching setInterval (tokio's plain `interval` fires at once).
        let mut ticker = tokio::time::interval_at(tokio::time::Instant::now() + period, period);
        loop {
            ticker.tick().await;
            let now = clock();
            let delta = now - last_tick;
            let force_wake = is_wake(delta, interval_ms);
            if force_wake {
                tracing::info!(target: "background-tasks:liveness", delta, "liveness: wake detected (wallclock jump)");
            }
            last_tick = now;
            run_liveness_sweep(&tracker, &mut miss_map, now, force_wake).await;
        }
    });
    LivenessSchedulerHandle { handle }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::lsof::{ExecFn, ExecOk, set_exec_for_tests};
    use crate::seam_test_guard;
    use crate::tracker::TaskSeed;
    use mainframe_types::background_task::BackgroundTaskToolName;
    use std::sync::atomic::{AtomicUsize, Ordering};

    fn seed_running(tracker: &BackgroundTaskTracker, chat_id: &str, id: &str, output_path: &str) {
        tracker.start(
            chat_id,
            TaskSeed {
                id: id.to_string(),
                tool_name: BackgroundTaskToolName::Bash,
                tool_use_id: "u".to_string(),
                command: "x".to_string(),
                description: String::new(),
            },
            output_path.to_string(),
        );
    }

    /// lsof seam producing writers `pids` (write-mode 'aw' lines).
    fn writers_exec(pids: &'static [u32]) -> ExecFn {
        Arc::new(move |_cmd, _args| {
            let mut stdout = String::new();
            for p in pids {
                stdout.push_str(&format!("p{p}\naw\nn/p\n"));
            }
            Box::pin(async move { Ok(ExecOk { stdout }) })
        })
    }

    fn now_ms() -> i64 {
        chrono::Utc::now().timestamp_millis()
    }

    #[tokio::test]
    async fn skips_tasks_younger_than_grace_ms() {
        let _guard = seam_test_guard();
        let calls = Arc::new(AtomicUsize::new(0));
        let calls2 = calls.clone();
        set_exec_for_tests(Arc::new(move |_c, _a| {
            calls2.fetch_add(1, Ordering::SeqCst);
            Box::pin(async {
                Ok(ExecOk {
                    stdout: String::new(),
                })
            })
        }));
        let tracker = BackgroundTaskTracker::new();
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
        let _guard = seam_test_guard();
        set_exec_for_tests(writers_exec(&[]));
        let tracker = BackgroundTaskTracker::new();
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
        let _guard = seam_test_guard();
        set_exec_for_tests(writers_exec(&[]));
        let tracker = BackgroundTaskTracker::new();
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
        let _guard = seam_test_guard();
        set_exec_for_tests(writers_exec(&[]));
        let tracker = BackgroundTaskTracker::new();
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
        let _guard = seam_test_guard();
        set_exec_for_tests(Arc::new(|_c, _a| {
            Box::pin(async {
                Err(crate::lsof::LsofExecError {
                    code: Some(crate::lsof::ExecCode::Text("ENOENT".to_string())),
                    signal: None,
                    stdout: None,
                })
            })
        }));
        let tracker = BackgroundTaskTracker::new();
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
        let _guard = seam_test_guard();
        let tracker = BackgroundTaskTracker::new();
        seed_running(&tracker, "c1", "t1", "/p/t1.out");
        let task_start = tracker.get("c1", "t1").unwrap().started_at;
        let mut miss = MissMap::new();

        set_exec_for_tests(writers_exec(&[]));
        run_liveness_sweep(&tracker, &mut miss, task_start + 100_000, false).await;
        assert_eq!(get_miss_count(&miss, "c1", "t1"), 1);

        set_exec_for_tests(writers_exec(&[555]));
        run_liveness_sweep(&tracker, &mut miss, task_start + 160_000, false).await;
        assert_eq!(get_miss_count(&miss, "c1", "t1"), 0);
        assert_eq!(tracker.get_pid("c1", "t1"), Some(555));
    }

    // --- wake-detection helper + composed scenario (drives the same decision the
    // scheduler loop makes, deterministically — the async interval loop is covered
    // by `stop_prevents_further_ticks`). ---

    #[test]
    fn is_wake_thresholds() {
        assert!(!is_wake(60_000, 60_000)); // 1× interval
        assert!(!is_wake(120_000, 60_000)); // exactly 2× is NOT a wake (strict >)
        assert!(is_wake(7 * 3600 * 1000, 60_000)); // 7h jump
    }

    #[tokio::test]
    async fn wallclock_jump_triggers_wake_mode_end() {
        let _guard = seam_test_guard();
        set_exec_for_tests(writers_exec(&[]));
        let tracker = BackgroundTaskTracker::new();
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
        let _guard = seam_test_guard();
        let calls = Arc::new(AtomicUsize::new(0));
        let calls2 = calls.clone();
        set_exec_for_tests(Arc::new(move |_c, _a| {
            calls2.fetch_add(1, Ordering::SeqCst);
            Box::pin(async {
                Ok(ExecOk {
                    stdout: String::new(),
                })
            })
        }));
        let tracker = Arc::new(BackgroundTaskTracker::new());
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
}

// PORT STATUS: src/background-tasks/liveness.ts (131 lines)
// confidence: high
// todos: 0
// notes: runLivenessSweep/getMissCount/setMiss/deleteMiss/startLivenessScheduler
// ported 1:1. setInterval → a spawned task with `interval_at(now+period,…)` so the
// first tick fires AFTER the interval (tokio's plain `interval` fires immediately,
// which would diverge from setInterval); JoinHandle.abort() = clearInterval + the
// `stopped` guard. `Date.now()` wallclock source is an injected Clock closure so
// wake-detection is deterministic; the wake decision is extracted to `is_wake`.
// All 6 sweep cases + wake + stop() translated from liveness.test.ts (the wake
// case drives run_liveness_sweep via is_wake rather than the flaky async interval).
