//! Claude quota pull cadence.
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

use mainframe_types::seam_error::SeamError;
use tokio::task::JoinHandle;

/// Claude's "always fresh" cadence (#252): pull `/usage` about every five minutes.
const CLAUDE_PULL_INTERVAL_MS: u64 = 5 * 60 * 1000;

/// Refresh the Claude quota (delegates to the `QuotaManager` puller). Errors are
/// swallowed so one failed pull never halts the cadence.
pub type RefreshFn =
    Arc<dyn Fn() -> Pin<Box<dyn Future<Output = Result<(), SeamError>> + Send>> + Send + Sync>;

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
#[path = "scheduler_tests.rs"]
mod tests;
