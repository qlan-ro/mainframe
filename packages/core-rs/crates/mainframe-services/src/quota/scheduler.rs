//! Ported from `src/quota/claude-scheduler.ts` — Claude's active pull cadence.
//!
//! One unconditional warm-up pull on start (the daemon boots with the app, so the
//! first glance reads fresh numbers), then a focus-gated interval: a timer tick
//! only pulls when a client is connected, so a backgrounded app spends no
//! `/usage` runs. There is no explicit focus signal, so a connected client stands
//! in for focus.

use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;
use std::time::Duration;

use tokio::task::JoinHandle;

/// Claude's "always fresh" cadence (#252): pull `/usage` about every five minutes.
const CLAUDE_PULL_INTERVAL_MS: u64 = 5 * 60 * 1000;

/// Refresh the Claude quota (delegates to the `QuotaManager` puller). Errors are
/// swallowed so one failed pull never halts the cadence.
pub type RefreshFn =
    Arc<dyn Fn() -> Pin<Box<dyn Future<Output = Result<(), String>> + Send>> + Send + Sync>;

/// Focus proxy: a connected client stands in for an explicit focus signal.
pub type HasClientsFn = Arc<dyn Fn() -> bool + Send + Sync>;

pub struct ClaudeQuotaSchedulerDeps {
    pub refresh: RefreshFn,
    pub has_clients: HasClientsFn,
    /// Defaults to `CLAUDE_PULL_INTERVAL_MS` when `None`.
    pub interval_ms: Option<u64>,
}

pub struct ClaudeQuotaScheduler {
    deps: Arc<ClaudeQuotaSchedulerDeps>,
    handle: Option<JoinHandle<()>>,
}

impl ClaudeQuotaScheduler {
    #[must_use]
    pub fn new(deps: ClaudeQuotaSchedulerDeps) -> Self {
        Self {
            deps: Arc::new(deps),
            handle: None,
        }
    }

    pub fn start(&mut self) {
        if self.handle.is_some() {
            return;
        }
        let deps = Arc::clone(&self.deps);
        self.handle = Some(tokio::spawn(async move { run(deps).await }));
    }

    pub fn stop(&mut self) {
        if let Some(handle) = self.handle.take() {
            handle.abort();
        }
    }
}

impl Drop for ClaudeQuotaScheduler {
    fn drop(&mut self) {
        self.stop();
    }
}

async fn run(deps: Arc<ClaudeQuotaSchedulerDeps>) {
    run_pull(&deps).await;
    let interval_ms = deps.interval_ms.unwrap_or(CLAUDE_PULL_INTERVAL_MS);
    let mut ticker = tokio::time::interval(Duration::from_millis(interval_ms));
    ticker.tick().await; // discard the immediate first tick
    loop {
        ticker.tick().await;
        if (deps.has_clients)() {
            run_pull(&deps).await;
        } else {
            tracing::debug!("quota: skipping timer pull — no connected clients");
        }
    }
}

async fn run_pull(deps: &ClaudeQuotaSchedulerDeps) {
    if let Err(err) = (deps.refresh)().await {
        tracing::warn!(error = %err, "claude quota pull failed");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

    fn counting_refresh(calls: Arc<AtomicUsize>, fail: bool) -> RefreshFn {
        Arc::new(move || {
            let calls = Arc::clone(&calls);
            Box::pin(async move {
                calls.fetch_add(1, Ordering::SeqCst);
                if fail {
                    Err("spawn failed".to_string())
                } else {
                    Ok(())
                }
            })
        })
    }

    async fn settle() {
        for _ in 0..8 {
            tokio::task::yield_now().await;
        }
    }

    async fn advance(ms: u64) {
        tokio::time::advance(Duration::from_millis(ms)).await;
        settle().await;
    }

    #[tokio::test(start_paused = true)]
    async fn runs_one_warm_up_pull_on_start_regardless_of_connected_clients() {
        let calls = Arc::new(AtomicUsize::new(0));
        let mut scheduler = ClaudeQuotaScheduler::new(ClaudeQuotaSchedulerDeps {
            refresh: counting_refresh(Arc::clone(&calls), false),
            has_clients: Arc::new(|| false),
            interval_ms: Some(1000),
        });
        scheduler.start();
        settle().await;
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        scheduler.stop();
    }

    #[tokio::test(start_paused = true)]
    async fn pulls_on_a_timer_tick_only_when_a_client_is_connected() {
        let calls = Arc::new(AtomicUsize::new(0));
        let connected = Arc::new(AtomicBool::new(false));
        let connected_for_dep = Arc::clone(&connected);
        let mut scheduler = ClaudeQuotaScheduler::new(ClaudeQuotaSchedulerDeps {
            refresh: counting_refresh(Arc::clone(&calls), false),
            has_clients: Arc::new(move || connected_for_dep.load(Ordering::SeqCst)),
            interval_ms: Some(1000),
        });
        scheduler.start();
        settle().await; // warm-up pull (1)
        assert_eq!(calls.load(Ordering::SeqCst), 1);

        advance(1000).await; // tick, no clients → skipped
        assert_eq!(calls.load(Ordering::SeqCst), 1);

        connected.store(true, Ordering::SeqCst);
        advance(1000).await; // tick, client present → pulls
        assert_eq!(calls.load(Ordering::SeqCst), 2);
        scheduler.stop();
    }

    #[tokio::test(start_paused = true)]
    async fn stop_halts_further_timer_pulls() {
        let calls = Arc::new(AtomicUsize::new(0));
        let mut scheduler = ClaudeQuotaScheduler::new(ClaudeQuotaSchedulerDeps {
            refresh: counting_refresh(Arc::clone(&calls), false),
            has_clients: Arc::new(|| true),
            interval_ms: Some(1000),
        });
        scheduler.start();
        settle().await; // warm-up pull (1)
        scheduler.stop();
        advance(5000).await;
        assert_eq!(calls.load(Ordering::SeqCst), 1);
    }

    #[tokio::test(start_paused = true)]
    async fn swallows_a_pull_rejection_and_keeps_ticking() {
        let calls = Arc::new(AtomicUsize::new(0));
        let mut scheduler = ClaudeQuotaScheduler::new(ClaudeQuotaSchedulerDeps {
            refresh: counting_refresh(Arc::clone(&calls), true),
            has_clients: Arc::new(|| true),
            interval_ms: Some(1000),
        });
        scheduler.start();
        settle().await; // warm-up (1), rejects
        advance(1000).await; // tick (2), rejects
        advance(1000).await; // tick (3) still fires despite prior rejections
        assert_eq!(calls.load(Ordering::SeqCst), 3);
        scheduler.stop();
    }
}
