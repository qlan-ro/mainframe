//! Scans for idle chats and triggers whole-chat offload (`idle_offload.rs`).

use mainframe_types::sync::LockExt as _;
use std::sync::Arc;
#[cfg(test)]
use std::sync::Mutex;

#[cfg(test)]
use dashmap::DashMap;
use mainframe_adapter_api::{AdapterSession, BoxFuture};
use tokio::task::JoinHandle;
use tracing::info;

#[cfg(test)]
use crate::types::ActiveChat;

/// 2 hours.
pub const IDLE_THRESHOLD_MS: i64 = 2 * 60 * 60 * 1000;
/// 5 minutes.
pub const IDLE_SCAN_INTERVAL_MS: u64 = 5 * 60 * 1000;

use crate::chat_manager::Registry;

type NowFn = Arc<dyn Fn() -> i64 + Send + Sync>;

/// The offload half of the scan (`idle_offload::ChatOffload`, wired as a trait
/// object so the scanner's periodic task needs no `Weak<ChatManager>`). Given a
/// candidate chat id, re-checks everything and either offloads it or no-ops.
pub trait IdleOffloader: Send + Sync {
    fn offload<'a>(&'a self, chat_id: &'a str) -> BoxFuture<'a, ()>;
}

/// Periodically offloads chats idle longer than the threshold, removing their
/// CLI process, daemon cache, and registry cell as one unit. The chat record
/// and `claudeSessionId` are untouched, so the next user message re-spawns via
/// `--resume`.
pub struct IdleSessionScanner {
    active_chats: Registry,
    offloader: Arc<dyn IdleOffloader>,
    threshold_ms: i64,
    interval_ms: u64,
    now: NowFn,
    handle: Option<JoinHandle<()>>,
}

impl IdleSessionScanner {
    pub fn new(active_chats: Registry, offloader: Arc<dyn IdleOffloader>) -> Self {
        Self::with_config(
            active_chats,
            offloader,
            IDLE_THRESHOLD_MS,
            IDLE_SCAN_INTERVAL_MS,
            Arc::new(now_ms),
        )
    }

    pub fn with_config(
        active_chats: Registry,
        offloader: Arc<dyn IdleOffloader>,
        threshold_ms: i64,
        interval_ms: u64,
        now: NowFn,
    ) -> Self {
        Self {
            active_chats,
            offloader,
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
        let offloader = self.offloader.clone();
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
                scan_registry(&active_chats, offloader.as_ref(), threshold_ms, &now).await;
            }
        }));
    }

    pub fn stop(&mut self) {
        if let Some(handle) = self.handle.take() {
            handle.abort();
        }
    }

    pub async fn scan(&self) {
        scan_registry(
            &self.active_chats,
            self.offloader.as_ref(),
            self.threshold_ms,
            &self.now,
        )
        .await;
    }
}

/// The single idle-eligibility rule, shared by
/// `select_idle_candidates` and `ChatOffload::recheck`: a spawned session's
/// idle clock is still `session.last_activity_at()` alone (unchanged —
/// `None` means "always active", exactly as before). Everything else — no
/// session at all, or a session handle that never spawned (a failed spawn, a
/// REST `/resume` that never started, or one whose process already exited) —
/// is eligible too, timed by `last_used_at` (bumped by `touch` on every use),
/// widened to the session's own activity time if it happens to report one.
/// Returns `None` only when the chat must never be considered idle (a
/// spawned session with no activity tracking).
pub fn idle_since(session: Option<&Arc<dyn AdapterSession>>, last_used_at: i64) -> Option<i64> {
    if let Some(session) = session
        && session.is_spawned()
    {
        return session.last_activity_at();
    }
    let session_activity = session.and_then(|s| s.last_activity_at());
    Some(match session_activity {
        Some(activity) => last_used_at.max(activity),
        None => last_used_at,
    })
}

/// Candidate selection is a pure read of the registry, with no I/O
/// and no chat-state mutation. A chat qualifies when `idle_since` (which
/// covers both a spawned session and a session-less/unspawned cell) reports
/// an idle clock past `threshold_ms`. Every other check (pending permission,
/// in-flight activity, a Working process) belongs to the offload's own
/// re-check, so a race between this read and that re-check (AC4) always
/// resolves in favor of NOT offloading a chat that woke up.
pub fn select_idle_candidates(active_chats: &Registry, now: i64, threshold_ms: i64) -> Vec<String> {
    active_chats
        .iter()
        .filter_map(|entry| {
            let (session, last_used_at) = {
                let guard = entry.value().lock_recover();
                (guard.session.clone(), guard.last_used_at)
            };
            let last = idle_since(session.as_ref(), last_used_at)?;
            if now - last <= threshold_ms {
                return None;
            }
            Some(entry.key().clone())
        })
        .collect()
}

async fn scan_registry(
    active_chats: &Registry,
    offloader: &dyn IdleOffloader,
    threshold_ms: i64,
    now: &NowFn,
) {
    let candidates = select_idle_candidates(active_chats, now(), threshold_ms);
    for chat_id in candidates {
        info!(chat_id, "offload candidate");
        offloader.offload(&chat_id).await;
    }
}

use mainframe_types::time::now_ms;

#[cfg(test)]
#[path = "idle_scanner_tests.rs"]
mod tests;
