use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use tokio::task::JoinHandle;

use mainframe_types::background_task::{BackgroundTaskStatus, BackgroundWorkKind};

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
pub(crate) fn get_miss_count(miss_map: &MissMap, chat_id: &str, task_id: &str) -> i64 {
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
pub(crate) async fn run_liveness_sweep(
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

        // lsof-writer liveness only holds for bash tasks (the shell keeps the
        // spool file open). Agents/workflows run inside the CLI and have no
        // writer — probing them would false-stop live work. They close via
        // task_notification bookends or endAllRunning on CLI exit.
        if task.kind != BackgroundWorkKind::Bash {
            continue;
        }
        if now - task.started_at < GRACE_MS {
            continue;
        }
        let Some(output_path) = task.output_path.clone() else {
            tracing::warn!(target: "background-tasks:liveness", chat_id = %chat_id, task_id = %task.id, "liveness skip: no outputPath");
            continue;
        };
        let pids = match lsof_writers_detailed(&tracker.process, &output_path).await {
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
    let clock: Clock = Arc::new(mainframe_types::time::now_ms);
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
mod tests;
