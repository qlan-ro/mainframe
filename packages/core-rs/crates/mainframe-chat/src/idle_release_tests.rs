use super::*;
use crate::idle_scanner::{IdleOffloader, IdleSessionScanner};
use crate::test_support::{FakeSession, test_chat};
use crate::types::ActiveChat;
use std::collections::HashSet;
use std::sync::Mutex;

const MINUTE: i64 = 60_000;
const NOW: i64 = 1_000 * MINUTE;

fn registry() -> Registry {
    Arc::new(dashmap::DashMap::new())
}

/// A chat with no process alive whose cell was last used `idle_ms` ago.
fn insert(reg: &Registry, id: &str, idle_ms: i64) {
    insert_with(reg, id, idle_ms, false);
}

fn insert_with(reg: &Registry, id: &str, idle_ms: i64, spawned: bool) {
    let mut active = ActiveChat::new(
        test_chat(id),
        Some(FakeSession::with_activity(spawned, Some(NOW - idle_ms))),
    );
    active.last_used_at = NOW - idle_ms;
    reg.insert(id.to_string(), Arc::new(Mutex::new(active)));
}

#[derive(Default)]
struct FakeReleaser {
    after: Option<i64>,
    viewed: Mutex<HashSet<String>>,
    released: Mutex<HashSet<String>>,
    calls: Mutex<Vec<(String, i64)>>,
}

impl FakeReleaser {
    fn after(minutes: i64) -> Arc<Self> {
        Arc::new(Self {
            after: Some(minutes * MINUTE),
            ..Self::default()
        })
    }
    fn view(&self, id: &str, on: bool) {
        let mut viewed = self.viewed.lock().unwrap();
        if on {
            viewed.insert(id.to_string());
        } else {
            viewed.remove(id);
        }
    }
    fn calls(&self) -> Vec<String> {
        self.calls
            .lock()
            .unwrap()
            .iter()
            .map(|(id, _)| id.clone())
            .collect()
    }
}

impl HistoryReleaser for FakeReleaser {
    fn release_after_ms(&self) -> BoxFuture<'_, Option<i64>> {
        Box::pin(async move { self.after })
    }
    fn holds_history(&self, chat_id: &str) -> bool {
        !self.released.lock().unwrap().contains(chat_id)
    }
    fn is_viewed(&self, chat_id: &str) -> bool {
        self.viewed.lock().unwrap().contains(chat_id)
    }
    fn release<'a>(&'a self, chat_id: &'a str, idle_before: i64) -> BoxFuture<'a, ()> {
        self.calls
            .lock()
            .unwrap()
            .push((chat_id.to_string(), idle_before));
        self.released.lock().unwrap().insert(chat_id.to_string());
        Box::pin(async {})
    }
}

#[derive(Default)]
struct RecordingOffloader {
    calls: Mutex<Vec<String>>,
}

impl IdleOffloader for RecordingOffloader {
    fn offload<'a>(&'a self, chat_id: &'a str) -> BoxFuture<'a, ()> {
        self.calls.lock().unwrap().push(chat_id.to_string());
        Box::pin(async {})
    }
}

fn scanner(
    reg: &Registry,
    releaser: Arc<FakeReleaser>,
    now: Arc<Mutex<i64>>,
) -> IdleSessionScanner {
    IdleSessionScanner::with_config(
        reg.clone(),
        Arc::new(RecordingOffloader::default()),
        crate::idle_scanner::IDLE_THRESHOLD_MS,
        60_000,
        Arc::new(move || *now.lock().unwrap()),
    )
    .with_releaser(releaser)
}

#[tokio::test]
async fn a_scan_releases_only_chats_idle_past_the_setting() {
    let reg = registry();
    insert(&reg, "idle", 11 * MINUTE);
    insert(&reg, "fresh", 9 * MINUTE);
    let releaser = FakeReleaser::after(10);

    scanner(&reg, releaser.clone(), Arc::new(Mutex::new(NOW)))
        .scan()
        .await;

    assert_eq!(releaser.calls(), vec!["idle"]);
    assert_eq!(
        releaser.calls.lock().unwrap()[0].1,
        NOW - 10 * MINUTE,
        "the release re-checks against the same idle boundary"
    );
}

#[tokio::test]
async fn a_longer_setting_or_never_keeps_the_history() {
    let reg = registry();
    insert(&reg, "idle", 45 * MINUTE);

    let hour = FakeReleaser::after(60);
    scanner(&reg, hour.clone(), Arc::new(Mutex::new(NOW)))
        .scan()
        .await;
    assert!(
        hour.calls().is_empty(),
        "an hour's setting keeps a chat idle 45 minutes"
    );

    let never = Arc::new(FakeReleaser::default());
    scanner(&reg, never.clone(), Arc::new(Mutex::new(NOW)))
        .scan()
        .await;
    assert!(never.calls().is_empty(), "never keeps every history");
}

#[tokio::test]
async fn a_viewed_chat_is_kept_and_waits_the_whole_idle_time_after_it_is_left() {
    let reg = registry();
    insert(&reg, "c1", 60 * MINUTE);
    let releaser = FakeReleaser::after(10);
    let now = Arc::new(Mutex::new(NOW));
    let scanner = scanner(&reg, releaser.clone(), now.clone());

    releaser.view("c1", true);
    scanner.scan().await;
    assert!(
        releaser.calls().is_empty(),
        "a viewed chat keeps its history"
    );

    releaser.view("c1", false);
    *now.lock().unwrap() = NOW + 9 * MINUTE;
    scanner.scan().await;
    assert!(
        releaser.calls().is_empty(),
        "viewing counts as use: nine minutes after the user left, it stays"
    );

    *now.lock().unwrap() = NOW + 11 * MINUTE;
    scanner.scan().await;
    assert_eq!(releaser.calls(), vec!["c1"]);
}

#[tokio::test]
async fn a_released_chat_is_not_selected_again() {
    let reg = registry();
    insert(&reg, "c1", 60 * MINUTE);
    let releaser = FakeReleaser::after(10);
    let scanner = scanner(&reg, releaser.clone(), Arc::new(Mutex::new(NOW)));

    scanner.scan().await;
    scanner.scan().await;

    assert_eq!(releaser.calls(), vec!["c1"]);
}

#[test]
fn use_of_the_cell_counts_even_with_a_spawned_session() {
    let session: Arc<dyn AdapterSession> =
        FakeSession::with_activity(true, Some(NOW - 60 * MINUTE));
    assert_eq!(
        release_idle_since(Some(&session), NOW - MINUTE),
        Some(NOW - MINUTE)
    );
    let untracked: Arc<dyn AdapterSession> = FakeSession::with_activity(true, None);
    assert_eq!(
        release_idle_since(Some(&untracked), NOW - 60 * MINUTE),
        None,
        "a session without activity tracking is never idle"
    );
}

#[tokio::test]
async fn a_chat_whose_process_is_alive_is_never_selected() {
    let reg = registry();
    insert_with(&reg, "live", 60 * MINUTE, true);
    insert(&reg, "idle", 60 * MINUTE);
    let releaser = FakeReleaser::after(10);

    scanner(&reg, releaser.clone(), Arc::new(Mutex::new(NOW)))
        .scan()
        .await;

    assert_eq!(releaser.calls(), vec!["idle"]);
}
