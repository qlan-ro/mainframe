//! Ported from `packages/core/src/chat/idle-scanner.ts`.

use std::sync::Arc;
use std::sync::Mutex;

use dashmap::DashMap;
use tokio::task::JoinHandle;
use tracing::{info, warn};

use crate::types::ActiveChat;

/// 2 hours.
pub const IDLE_THRESHOLD_MS: i64 = 2 * 60 * 60 * 1000;
/// 5 minutes.
pub const IDLE_SCAN_INTERVAL_MS: u64 = 5 * 60 * 1000;

/// The active-chat registry the scanner reads (CONCURRENCY.tsv: SHARED_MAP, the
/// per-entity value is `Arc<Mutex<ActiveChat>>` until chat_manager promotes it to
/// `ChatState`). The scanner is `SINGLE_TASK`: one spawned interval task.
pub type ActiveChatRegistry = Arc<DashMap<String, Arc<Mutex<ActiveChat>>>>;

type NowFn = Arc<dyn Fn() -> i64 + Send + Sync>;

/// Periodically kills CLI sessions that have been idle longer than the
/// threshold. The chat record and `claudeSessionId` are preserved so the next
/// user message re-spawns via `--resume`.
pub struct IdleSessionScanner {
    active_chats: ActiveChatRegistry,
    threshold_ms: i64,
    interval_ms: u64,
    now: NowFn,
    handle: Option<JoinHandle<()>>,
}

impl IdleSessionScanner {
    pub fn new(active_chats: ActiveChatRegistry) -> Self {
        Self::with_config(
            active_chats,
            IDLE_THRESHOLD_MS,
            IDLE_SCAN_INTERVAL_MS,
            Arc::new(now_ms),
        )
    }

    pub fn with_config(
        active_chats: ActiveChatRegistry,
        threshold_ms: i64,
        interval_ms: u64,
        now: NowFn,
    ) -> Self {
        Self {
            active_chats,
            threshold_ms,
            interval_ms,
            now,
            handle: None,
        }
    }

    pub fn start(&mut self) {
        if self.handle.is_some() {
            return;
        }
        let active_chats = self.active_chats.clone();
        let threshold_ms = self.threshold_ms;
        let now = self.now.clone();
        let period = std::time::Duration::from_millis(self.interval_ms);
        self.handle = Some(tokio::spawn(async move {
            let mut ticker = tokio::time::interval(period);
            ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
            // First tick fires immediately; skip it to mirror setInterval (fires
            // after the first period, not at t=0).
            ticker.tick().await;
            loop {
                ticker.tick().await;
                scan_registry(&active_chats, threshold_ms, &now).await;
            }
        }));
    }

    pub fn stop(&mut self) {
        if let Some(handle) = self.handle.take() {
            handle.abort();
        }
    }

    pub async fn scan(&self) {
        scan_registry(&self.active_chats, self.threshold_ms, &self.now).await;
    }
}

async fn scan_registry(active_chats: &ActiveChatRegistry, threshold_ms: i64, now: &NowFn) {
    let now = now();
    // Snapshot the registry (clone the per-entity Arcs) so no DashMap shard guard
    // is held across the `.await` on `session.kill()` (CONCURRENCY rules 2-3).
    let entries: Vec<(String, Arc<Mutex<ActiveChat>>)> = active_chats
        .iter()
        .map(|e| (e.key().clone(), e.value().clone()))
        .collect();
    for (chat_id, cell) in entries {
        let session = {
            let guard = cell.lock().unwrap_or_else(|e| e.into_inner());
            guard.session.clone()
        };
        let Some(session) = session else { continue };
        if !session.is_spawned() {
            continue;
        }
        let Some(last) = session.last_activity_at() else {
            continue;
        };
        let idle_ms = now - last;
        if idle_ms <= threshold_ms {
            continue;
        }
        info!(chat_id, idle_ms, "evicting idle claude session");
        if let Err(err) = session.kill().await {
            warn!(?err, chat_id, "failed to kill idle session");
        }
    }
}

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::{FakeSession, test_chat};

    fn registry() -> ActiveChatRegistry {
        Arc::new(DashMap::new())
    }

    fn insert(reg: &ActiveChatRegistry, id: &str, session: Arc<FakeSession>) {
        reg.insert(
            id.to_string(),
            Arc::new(Mutex::new(ActiveChat {
                chat: test_chat(id),
                session: Some(session),
                turn_started_at: None,
            })),
        );
    }

    #[tokio::test]
    async fn evicts_sessions_idle_longer_than_threshold() {
        let now: i64 = 10_000_000;
        let threshold_ms: i64 = 2 * 60 * 60 * 1000;
        let idle = FakeSession::with_activity(true, Some(now - threshold_ms - 1));
        let active = FakeSession::with_activity(true, Some(now - 1000));
        let reg = registry();
        insert(&reg, "idle-chat", idle.clone());
        insert(&reg, "active-chat", active.clone());

        let scanner =
            IdleSessionScanner::with_config(reg, threshold_ms, 60_000, Arc::new(move || now));
        scanner.scan().await;

        assert_eq!(idle.kills(), 1);
        assert_eq!(active.kills(), 0);
    }

    #[tokio::test]
    async fn skips_sessions_that_are_not_spawned() {
        let now: i64 = 10_000_000;
        let threshold_ms: i64 = 1000;
        let dead = FakeSession::with_activity(false, Some(now - 10_000));
        let reg = registry();
        insert(&reg, "dead", dead.clone());

        let scanner =
            IdleSessionScanner::with_config(reg, threshold_ms, 60_000, Arc::new(move || now));
        scanner.scan().await;

        assert_eq!(dead.kills(), 0);
    }

    #[tokio::test]
    async fn skips_sessions_without_last_activity_at_tracking() {
        let now: i64 = 10_000_000;
        let session = FakeSession::with_activity(true, None);
        let reg = registry();
        insert(&reg, "x", session.clone());

        let scanner = IdleSessionScanner::with_config(reg, 100, 60_000, Arc::new(move || now));
        scanner.scan().await;

        assert_eq!(session.kills(), 0);
    }
}

// PORT STATUS: src/chat/idle-scanner.ts (58 lines)
// confidence: high
// todos: 0
// notes: `timer`/`setInterval` → a spawned tokio interval task + JoinHandle (SINGLE_TASK,
// notes: CONCURRENCY.tsv); `stop()` aborts. The first interval tick is skipped so the
// notes: loop fires after one period (setInterval semantics); `unref()` has no tokio
// notes: analogue (dropped — ordered shutdown aborts the handle). `scan()` snapshots
// notes: the SHARED_MAP and drops the chat lock before `session.kill().await` (rules
// notes: 2-3). Injected `now` closure mirrors the TS `now = () => Date.now()` seam;
// notes: all three idle-scanner test cases ported.
