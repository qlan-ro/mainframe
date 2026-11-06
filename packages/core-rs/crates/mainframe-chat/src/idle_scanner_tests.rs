use super::*;
use crate::test_support::{FakeSession, test_chat};
use std::sync::Mutex as StdMutex;

fn registry() -> Registry {
    Arc::new(DashMap::new())
}

fn insert(reg: &Registry, id: &str, session: Arc<FakeSession>, last_used_at: i64) {
    reg.insert(
        id.to_string(),
        Arc::new(Mutex::new(ActiveChat {
            chat: test_chat(id),
            session: Some(session),
            turn_started_at: None,
            running_since_ms: None,
            last_used_at,
        })),
    );
}

fn insert_sessionless(reg: &Registry, id: &str, last_used_at: i64) {
    reg.insert(
        id.to_string(),
        Arc::new(Mutex::new(ActiveChat {
            chat: test_chat(id),
            session: None,
            turn_started_at: None,
            running_since_ms: None,
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

// ── Unspawned-cell eligibility ──────────────────────────────

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

/// An unspawned cell's eligibility comes from `last_used_at`, not
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
