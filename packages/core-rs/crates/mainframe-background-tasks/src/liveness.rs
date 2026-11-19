//! Periodic check that running bash tasks still have a process writing their
//! spool file, so a task whose shell died without a CLI notification stops.

use std::collections::HashSet;
use std::sync::Arc;
use std::time::Duration;

use tokio::task::JoinHandle;

use mainframe_types::background_task::{BackgroundTaskStatus, BackgroundWorkKind};

use crate::lsof::lsof_writers;
use crate::tracker::{BackgroundTaskTracker, TerminalUpdate};

const TICK: Duration = Duration::from_secs(60);
/// A task younger than this is never probed: its shell may not have opened
/// the spool file yet.
const GRACE_MS: i64 = 90_000;
/// A wall-clock gap longer than this many tick periods means the machine
/// slept, so one empty probe is enough to stop a task.
const WAKE_DELTA_MULT: i64 = 2;

/// Tasks whose last probe found no writer, keyed by `(chat_id, task_id)`. A
/// second empty probe in a row stops the task.
type Suspects = HashSet<(String, String)>;

/// Aborts the sweep loop when stopped or dropped.
pub struct LivenessSchedulerHandle {
    handle: JoinHandle<()>,
}

impl LivenessSchedulerHandle {
    pub fn stop(&self) {
        self.handle.abort();
    }
}

impl Drop for LivenessSchedulerHandle {
    fn drop(&mut self) {
        self.handle.abort();
    }
}

/// Whether the wall clock moved further than the tick period can explain.
fn is_wake(delta_ms: i64, period: Duration) -> bool {
    let period_ms = i64::try_from(period.as_millis()).unwrap_or(i64::MAX);
    delta_ms > period_ms.saturating_mul(WAKE_DELTA_MULT)
}

/// One sweep over every running bash task.
async fn run_liveness_sweep(
    tracker: &BackgroundTaskTracker,
    suspects: &mut Suspects,
    now: i64,
    force_wake: bool,
) {
    let mut running = Suspects::new();
    for (chat_id, task) in tracker.list_all_running() {
        let key = (chat_id, task.id.clone());
        running.insert(key.clone());

        // Only a bash task's shell keeps the spool file open. Agents and
        // workflows run inside the CLI and have no writer, so probing them
        // would stop live work; they end through task notifications or
        // `end_all_running` when the CLI exits.
        if task.kind != BackgroundWorkKind::Bash || now - task.started_at < GRACE_MS {
            continue;
        }
        let Some(output_path) = task.output_path else {
            tracing::warn!(chat_id = %key.0, task_id = %key.1, "running bash task has no output path");
            continue;
        };
        // A failed probe proves nothing; never stop a task on it.
        let Ok(pids) = lsof_writers(&tracker.process, &output_path).await else {
            continue;
        };
        if let Some(&pid) = pids.first() {
            tracker.set_pid(&key.0, &key.1, pid);
            suspects.remove(&key);
        } else if force_wake || suspects.contains(&key) {
            suspects.remove(&key);
            tracker.end(
                &key.0,
                &key.1,
                TerminalUpdate {
                    status: BackgroundTaskStatus::Stopped,
                    output_path,
                    summary: "process gone (liveness sweep)".to_string(),
                    usage: None,
                },
            );
        } else {
            suspects.insert(key);
        }
    }
    suspects.retain(|key| running.contains(key));
}

/// Sweep every minute until the returned handle is stopped or dropped.
pub fn start_liveness_scheduler(tracker: Arc<BackgroundTaskTracker>) -> LivenessSchedulerHandle {
    start_liveness_scheduler_every(tracker, TICK)
}

fn start_liveness_scheduler_every(
    tracker: Arc<BackgroundTaskTracker>,
    period: Duration,
) -> LivenessSchedulerHandle {
    let clock = mainframe_types::time::now_ms;
    let handle = tokio::spawn(async move {
        let mut suspects = Suspects::new();
        let mut last_tick = clock();
        // The first sweep runs one period after start, not immediately.
        let mut ticker = tokio::time::interval_at(tokio::time::Instant::now() + period, period);
        loop {
            ticker.tick().await;
            let now = clock();
            let delta = now - last_tick;
            last_tick = now;
            let force_wake = is_wake(delta, period);
            if force_wake {
                tracing::info!(delta, "wake detected (wall-clock jump)");
            }
            run_liveness_sweep(&tracker, &mut suspects, now, force_wake).await;
        }
    });
    LivenessSchedulerHandle { handle }
}

#[cfg(test)]
#[path = "liveness_tests.rs"]
mod tests;
