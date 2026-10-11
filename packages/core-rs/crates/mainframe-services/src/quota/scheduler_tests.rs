use super::*;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

fn counting_refresh(calls: Arc<AtomicUsize>, fail: bool) -> RefreshFn {
    Arc::new(move || {
        let calls = Arc::clone(&calls);
        Box::pin(async move {
            calls.fetch_add(1, Ordering::SeqCst);
            if fail {
                Err(SeamError::msg("spawn failed"))
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
