//! Ported from `packages/core/src/chat/idle-scanner.ts`; extended (todo #178)
//! from a bare CLI-process kill into a trigger for the full idle whole-chat
//! offload (`idle_offload.rs`).

use std::sync::Arc;
use std::sync::Mutex;

use dashmap::DashMap;
use mainframe_adapter_api::{AdapterSession, BoxFuture};
use tokio::task::JoinHandle;
use tracing::info;

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

/// The offload half of the scan (`idle_offload::ChatOffload`, wired as a trait
/// object so the scanner's periodic task needs no `Weak<ChatManager>`). Given a
/// candidate chat id, re-checks everything and either offloads it or no-ops.
pub trait IdleOffloader: Send + Sync {
    fn offload<'a>(&'a self, chat_id: &'a str) -> BoxFuture<'a, ()>;
}

/// Periodically offloads (todo #178: CLI process + daemon cache + registry
/// cell, as one unit) chats idle longer than the threshold. The chat record
/// and `claudeSessionId` are untouched, so the next user message re-spawns via
/// `--resume`.
pub struct IdleSessionScanner {
    active_chats: ActiveChatRegistry,
    offloader: Arc<dyn IdleOffloader>,
    threshold_ms: i64,
    interval_ms: u64,
    now: NowFn,
    handle: Option<JoinHandle<()>>,
}

impl IdleSessionScanner {
    pub fn new(active_chats: ActiveChatRegistry, offloader: Arc<dyn IdleOffloader>) -> Self {
        Self::with_config(
            active_chats,
            offloader,
            IDLE_THRESHOLD_MS,
            IDLE_SCAN_INTERVAL_MS,
            Arc::new(now_ms),
        )
    }

    pub fn with_config(
        active_chats: ActiveChatRegistry,
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

/// The single idle-eligibility rule (todo #381 "Design"), shared by
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

/// Candidate selection (plan "Design"): a pure read of the registry, no I/O
/// and no chat-state mutation. A chat qualifies when `idle_since` (which
/// covers both a spawned session and a session-less/unspawned cell) reports
/// an idle clock past `threshold_ms`. Every other check (pending permission,
/// in-flight activity, a Working process) belongs to the offload's own
/// re-check, so a race between this read and that re-check (AC4) always
/// resolves in favor of NOT offloading a chat that woke up.
pub fn select_idle_candidates(
    active_chats: &ActiveChatRegistry,
    now: i64,
    threshold_ms: i64,
) -> Vec<String> {
    active_chats
        .iter()
        .filter_map(|entry| {
            let (session, last_used_at) = {
                let guard = entry.value().lock().unwrap_or_else(|e| e.into_inner());
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
    active_chats: &ActiveChatRegistry,
    offloader: &dyn IdleOffloader,
    threshold_ms: i64,
    now: &NowFn,
) {
    let candidates = select_idle_candidates(active_chats, now(), threshold_ms);
    for chat_id in candidates {
        info!(chat_id, "idle scanner: offload candidate");
        offloader.offload(&chat_id).await;
    }
}

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::{FakeSession, test_chat};
    use std::sync::Mutex as StdMutex;

    fn registry() -> ActiveChatRegistry {
        Arc::new(DashMap::new())
    }

    fn insert(reg: &ActiveChatRegistry, id: &str, session: Arc<FakeSession>, last_used_at: i64) {
        reg.insert(
            id.to_string(),
            Arc::new(Mutex::new(ActiveChat {
                chat: test_chat(id),
                session: Some(session),
                turn_started_at: None,
                last_used_at,
            })),
        );
    }

    fn insert_sessionless(reg: &ActiveChatRegistry, id: &str, last_used_at: i64) {
        reg.insert(
            id.to_string(),
            Arc::new(Mutex::new(ActiveChat {
                chat: test_chat(id),
                session: None,
                turn_started_at: None,
                last_used_at,
            })),
        );
    }

    #[test]
    fn selects_sessions_idle_longer_than_threshold() {
        let now: i64 = 10_000_000;
        let threshold_ms: i64 = 2 * 60 * 60 * 1000;
        let idle = FakeSession::with_activity(true, Some(now - threshold_ms - 1));
        let active = FakeSession::with_activity(true, Some(now - 1000));
        let reg = registry();
        insert(&reg, "idle-chat", idle, now);
        insert(&reg, "active-chat", active, now);

        let candidates = select_idle_candidates(&reg, now, threshold_ms);

        assert_eq!(candidates, vec!["idle-chat".to_string()]);
    }

    #[test]
    fn skips_sessions_without_last_activity_at_tracking() {
        let now: i64 = 10_000_000;
        let session = FakeSession::with_activity(true, None);
        let reg = registry();
        insert(&reg, "x", session, now);

        assert!(select_idle_candidates(&reg, now, 100).is_empty());
    }

    // ── todo #381: unspawned-cell eligibility ──────────────────────────────

    #[test]
    fn a_session_less_cell_idle_past_the_threshold_is_selected() {
        let now: i64 = 10_000_000;
        let threshold_ms: i64 = 2 * 60 * 60 * 1000;
        let reg = registry();
        insert_sessionless(&reg, "never-sent", now - threshold_ms - 1);

        let candidates = select_idle_candidates(&reg, now, threshold_ms);

        assert_eq!(candidates, vec!["never-sent".to_string()]);
    }

    #[test]
    fn an_unspawned_session_handle_with_an_old_last_used_at_is_selected() {
        let now: i64 = 10_000_000;
        let threshold_ms: i64 = 2 * 60 * 60 * 1000;
        // A failed-spawn or exited handle: `is_spawned()` is false, and its own
        // `last_activity_at` is ancient too — `last_used_at` alone drives this.
        let dead = FakeSession::with_activity(false, Some(now - threshold_ms - 1));
        let reg = registry();
        insert(&reg, "dead", dead, now - threshold_ms - 1);

        let candidates = select_idle_candidates(&reg, now, threshold_ms);

        assert_eq!(candidates, vec!["dead".to_string()]);
    }

    /// The new rule (todo #381), replacing the old `skips_sessions_that_are_not_spawned`
    /// coincidence: an unspawned cell's eligibility comes from `last_used_at`, not
    /// from `is_spawned()` alone — a FRESH `last_used_at` keeps it out even when the
    /// session handle (if any) or the persisted chat's own timestamps are ancient.
    #[test]
    fn a_fresh_last_used_at_keeps_an_unspawned_cell_out_regardless_of_old_session_activity() {
        let now: i64 = 10_000_000;
        let threshold_ms: i64 = 2 * 60 * 60 * 1000;
        let dead = FakeSession::with_activity(false, Some(now - 999_999_999));
        let reg = registry();
        insert(&reg, "fresh", dead, now);
        insert_sessionless(&reg, "fresh-sessionless", now);

        assert!(select_idle_candidates(&reg, now, threshold_ms).is_empty());
    }

    struct RecordingOffloader {
        calls: StdMutex<Vec<String>>,
    }

    impl IdleOffloader for RecordingOffloader {
        fn offload<'a>(&'a self, chat_id: &'a str) -> BoxFuture<'a, ()> {
            self.calls.lock().unwrap().push(chat_id.to_string());
            Box::pin(async {})
        }
    }

    #[tokio::test]
    async fn scan_drives_the_offloader_for_every_idle_candidate_only() {
        let now: i64 = 10_000_000;
        let threshold_ms: i64 = 2 * 60 * 60 * 1000;
        let idle = FakeSession::with_activity(true, Some(now - threshold_ms - 1));
        let active = FakeSession::with_activity(true, Some(now - 1000));
        let reg = registry();
        insert(&reg, "idle-chat", idle, now);
        insert(&reg, "active-chat", active, now);
        let offloader = Arc::new(RecordingOffloader {
            calls: StdMutex::new(Vec::new()),
        });

        let scanner = IdleSessionScanner::with_config(
            reg,
            offloader.clone(),
            threshold_ms,
            60_000,
            Arc::new(move || now),
        );
        scanner.scan().await;

        assert_eq!(offloader.calls.lock().unwrap().clone(), vec!["idle-chat"]);
    }
}

// PORT STATUS: src/chat/idle-scanner.ts (58 lines)
// confidence: high
// todos: 0
// notes: `timer`/`setInterval` → a spawned tokio interval task + JoinHandle (SINGLE_TASK,
// notes: CONCURRENCY.tsv); `stop()` aborts. The first interval tick is skipped so the
// notes: loop fires after one period (setInterval semantics); `unref()` has no tokio
// notes: analogue (dropped — ordered shutdown aborts the handle). `scan()` snapshots
// notes: the SHARED_MAP via `select_idle_candidates` (no shard guard held across an
// notes: `.await`, rules 2-3). Injected `now` closure mirrors the TS `now = () =>
// notes: Date.now()` seam; all three original idle-scanner test cases ported as pure
// notes: `select_idle_candidates` checks.
// notes: todo #178 split the bare `session.kill()` into candidate selection (here,
// notes: pure) + a full offload re-check-and-release sequence (`idle_offload.rs`,
// notes: `IdleOffloader` trait object) so a race between the two steps always favors
// notes: NOT offloading a chat that woke up (AC4). Behavioral offload coverage
// notes: (kill/cache/registry/event, permission skip, race, idempotency — AC1-5)
// notes: lives in `chat_manager::tests::offload`, where a real `ChatManager` wires the
// notes: real `ChatOffload` end to end.
