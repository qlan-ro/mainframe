//! The first window built from an adapter's history pages
//! (`chat_manager/adapter_window.rs`).
use super::*;
use mainframe_adapter_api::test_support::{FakePages, FakeSession};
use serde_json::json;

fn message(id: &str) -> ChatMessage {
    serde_json::from_value(json!({"id":id,"chatId":"c1","type":"user",
        "timestamp":"2026-11-27T00:00:00Z","content":[{"type":"text","text":id}]}))
    .unwrap()
}

/// Pages newest first, each holding `per_page` messages named `m<n>`; the
/// whole transcript is `pages * per_page` messages, oldest `m0`.
fn pages(pages: usize, per_page: usize) -> Vec<Vec<ChatMessage>> {
    (0..pages)
        .map(|page| {
            let newest = (pages - page) * per_page;
            (newest - per_page..newest)
                .map(|n| message(&format!("m{n}")))
                .collect()
        })
        .collect()
}

fn manager(session: Arc<FakeSession>) -> (Arc<FakeDeps>, ChatManager) {
    let mut chat = test_chat("c1");
    chat.vendor_session_id = Some("session".into());
    let deps = FakeDeps::with_chats(vec![chat]);
    *deps.adapters.session_to_return.lock().unwrap() = Some(session);
    *deps.adapters.history.lock().unwrap() = Some(Vec::new());
    let manager = ChatManager::new(deps.clone());
    (deps, manager)
}

fn session(history_pages: Vec<Vec<ChatMessage>>) -> Arc<FakeSession> {
    Arc::new(FakeSession {
        pager: FakePages {
            pages: history_pages,
            ..Default::default()
        },
        history: vec![message("whole")],
        ..Default::default()
    })
}

#[tokio::test]
async fn the_window_is_the_newest_page_and_never_reads_the_whole_history() {
    let session = session(pages(3, 5));
    let (_, manager) = manager(Arc::clone(&session));

    let window = manager.adapter_first_window("c1", 4).await.unwrap();

    let ids: Vec<_> = window.messages.iter().map(|m| m.id.as_str()).collect();
    assert_eq!(ids, ["m10", "m11", "m12", "m13", "m14"]);
    assert!(window.has_older, "two older pages remain");
    assert_eq!(*session.pager.requests.lock().unwrap(), [None]);
    assert!(
        manager.shared.messages.lock().unwrap().get("c1").is_none(),
        "a window never fills the chat's message cache"
    );
}

#[tokio::test]
async fn older_pages_are_read_by_cursor_until_the_window_is_full() {
    let session = session(pages(3, 5));
    let (_, manager) = manager(Arc::clone(&session));

    let window = manager.adapter_first_window("c1", 12).await.unwrap();

    assert_eq!(window.messages.len(), 15);
    assert_eq!(window.messages[0].id, "m0");
    assert!(!window.has_older, "the oldest page ends the history");
    assert_eq!(
        *session.pager.requests.lock().unwrap(),
        [None, Some("1".to_string()), Some("2".to_string())]
    );
}

#[tokio::test]
async fn an_adapter_that_cannot_page_gets_the_normal_load() {
    let session = session(Vec::new());
    let (_, manager) = manager(session);

    assert!(manager.adapter_first_window("c1", 4).await.is_none());
}

#[tokio::test]
async fn a_chat_already_in_the_cache_is_not_rebuilt_from_pages() {
    let session = session(pages(2, 5));
    let (_, manager) = manager(Arc::clone(&session));
    manager
        .shared
        .messages
        .lock()
        .unwrap()
        .set("c1", vec![message("cached")]);

    assert!(manager.adapter_first_window("c1", 4).await.is_none());
    assert!(session.pager.requests.lock().unwrap().is_empty());
}

#[tokio::test]
async fn a_snapshot_keeps_serving_instead_of_pages() {
    let dir = tempfile::tempdir().unwrap();
    let session = session(pages(2, 5));
    let (deps, _) = manager(Arc::clone(&session));
    deps.set_history_cache_dir(&dir.path().join("cache").to_string_lossy());
    let manager = ChatManager::new(deps);
    tokio::fs::create_dir_all(dir.path().join("cache")).await.unwrap();
    assert!(
        manager.adapter_first_window("c1", 4).await.is_some(),
        "without a snapshot the pages serve"
    );
    session.pager.requests.lock().unwrap().clear();
    tokio::fs::write(dir.path().join("cache").join("c1.json"), "{}")
        .await
        .unwrap();

    assert!(manager.adapter_first_window("c1", 4).await.is_none());
    assert!(session.pager.requests.lock().unwrap().is_empty());
}
