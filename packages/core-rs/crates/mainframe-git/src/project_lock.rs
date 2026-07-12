//! Ported from `packages/core/src/git/project-lock.ts`.
//!
//! Per-project async mutex map. The TS module chained a `Map<string,
//! Promise<void>>` and returned a `release()` callback; the Rust port keeps one
//! `tokio::sync::Mutex` per project path (fair → FIFO) and hands back an owned
//! guard whose drop *is* the release. Per CONCURRENCY.tsv this state is a
//! module-level `SHARED_MAP` behind a `OnceLock` (no `lazy_static`/`static mut`),
//! orthogonal to the chat lock (never nested with it — lock-ordering rule 6).

use std::sync::{Arc, OnceLock};

use dashmap::DashMap;
use tokio::sync::{Mutex, OwnedMutexGuard};

type Locks = DashMap<String, Arc<Mutex<()>>>;

fn locks() -> &'static Locks {
    static LOCKS: OnceLock<Locks> = OnceLock::new();
    LOCKS.get_or_init(Locks::new)
}

/// Acquire a mutex for a project path. Returns a guard; dropping it releases the
/// lock (mirrors the TS `release()` callback). Concurrent callers on the same
/// path wait in FIFO order.
pub async fn acquire_project_lock(project_path: &str) -> OwnedMutexGuard<()> {
    // Clone the per-path Arc out of the map, then drop the shard guard *before*
    // awaiting the lock (never hold a DashMap shard guard across `.await`).
    let mutex = locks()
        .entry(project_path.to_string())
        .or_insert_with(|| Arc::new(Mutex::new(())))
        .clone();
    mutex.lock_owned().await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::time::Duration;

    #[tokio::test]
    async fn serializes_concurrent_callers_on_same_path() {
        let order = Arc::new(Mutex::new(Vec::<usize>::new()));
        let active = Arc::new(AtomicUsize::new(0));
        let max_active = Arc::new(AtomicUsize::new(0));

        let mut handles = Vec::new();
        for id in 0..5 {
            let order = order.clone();
            let active = active.clone();
            let max_active = max_active.clone();
            handles.push(tokio::spawn(async move {
                let _guard = acquire_project_lock("/same/project").await;
                let now = active.fetch_add(1, Ordering::SeqCst) + 1;
                max_active.fetch_max(now, Ordering::SeqCst);
                tokio::time::sleep(Duration::from_millis(5)).await;
                order.lock().await.push(id);
                active.fetch_sub(1, Ordering::SeqCst);
            }));
        }
        for h in handles {
            h.await.unwrap();
        }

        // Only one caller ever held the lock at a time.
        assert_eq!(max_active.load(Ordering::SeqCst), 1);
        assert_eq!(order.lock().await.len(), 5);
    }

    #[tokio::test]
    async fn distinct_paths_do_not_block_each_other() {
        let _a = acquire_project_lock("/project/a").await;
        // A different path must be immediately acquirable while /project/a is held.
        let acquired = tokio::time::timeout(
            Duration::from_millis(100),
            acquire_project_lock("/project/b"),
        )
        .await;
        assert!(acquired.is_ok());
    }
}

// PORT STATUS: packages/core/src/git/project-lock.ts (20 lines)
// confidence: high
// notes: The TS FIFO promise-chain becomes one tokio::sync::Mutex per path
// (tokio's Mutex is fair, so FIFO holds). `release()` -> dropping the returned
// OwnedMutexGuard. State: OnceLock<DashMap<String, Arc<Mutex<()>>>> per
// CONCURRENCY.tsv (SHARED_MAP; module-level singleton, no static mut). Key is
// String (the raw project path, matching the TS Map<string> key) rather than the
// tsv's suggested PathBuf, to avoid path normalization diverging from TS keying.
