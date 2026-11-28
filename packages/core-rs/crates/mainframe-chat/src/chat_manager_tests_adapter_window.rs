//! The first window built from an adapter's history pages
//! (`chat_manager/adapter_window.rs`).
use super::*;
use mainframe_adapter_api::test_support::{FakePages, FakeSession};
use serde_json::json;
use std::sync::atomic::{AtomicUsize, Ordering};

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
    assert_eq!(*session.pager.requests.lock().unwrap(), [0]);
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
    assert_eq!(*session.pager.requests.lock().unwrap(), [0, 1, 2]);
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

/// A manager over `transcript` whose snapshot cache lives in `cache`, and its
/// session, which pages `pages(2, 5)`.
fn snapshot_manager(
    cache: &std::path::Path,
    transcript: &std::path::Path,
) -> (Arc<FakeSession>, ChatManager) {
    let session = Arc::new(FakeSession {
        pager: FakePages {
            pages: pages(2, 5),
            ..Default::default()
        },
        history: vec![message("whole")],
        history_sources: vec![transcript.to_path_buf()],
        ..Default::default()
    });
    let (deps, _) = manager(Arc::clone(&session));
    deps.set_history_cache_dir(&cache.to_string_lossy());
    (session, ChatManager::new(deps))
}

/// Writes the snapshot a full load leaves behind, as a previous run would.
async fn write_snapshot(cache: &std::path::Path, transcript: &std::path::Path) {
    let (_, manager) = snapshot_manager(cache, transcript);
    manager.get_messages("c1").await;
    manager.shared.history_cache.flush().await;
    manager.dispose();
}

#[tokio::test]
async fn a_current_snapshot_keeps_serving_instead_of_pages() {
    let dir = tempfile::tempdir().unwrap();
    let (cache, transcript) = (dir.path().join("cache"), dir.path().join("session.jsonl"));
    tokio::fs::write(&transcript, "{}\n").await.unwrap();
    write_snapshot(&cache, &transcript).await;
    let (session, manager) = snapshot_manager(&cache, &transcript);

    assert!(!manager.adapter_window_candidate("c1").await);
    assert!(manager.adapter_first_window("c1", 4).await.is_none());
    assert!(session.pager.requests.lock().unwrap().is_empty());
}

#[tokio::test]
async fn a_stale_snapshot_lets_the_pages_serve() {
    let dir = tempfile::tempdir().unwrap();
    let (cache, transcript) = (dir.path().join("cache"), dir.path().join("session.jsonl"));
    tokio::fs::write(&transcript, "{}\n").await.unwrap();
    write_snapshot(&cache, &transcript).await;
    // A turn the daemon never saw (or an update) leaves the snapshot stale:
    // reading it would only lead to the full parse.
    tokio::fs::write(&transcript, "{}\n{}\n").await.unwrap();
    let (session, manager) = snapshot_manager(&cache, &transcript);

    assert!(manager.adapter_window_candidate("c1").await);
    assert!(manager.adapter_first_window("c1", 4).await.is_some());
    assert_eq!(*session.pager.requests.lock().unwrap(), [0]);
}

#[derive(Default)]
struct Resyncs(AtomicUsize);
impl crate::chat_surface::ChatSurface for Resyncs {
    fn on_chat_surface_event(&self, event: crate::chat_surface::ChatSurfaceEvent) {
        if matches!(event, crate::chat_surface::ChatSurfaceEvent::Resync { .. }) {
            self.0.fetch_add(1, Ordering::SeqCst);
        }
    }
}

/// A chat whose pages are `pages(3, 5)` and whose whole history is `full`,
/// opened through a window and then loaded in full, as a resume does.
async fn resyncs_after_window_then_load(full: Vec<ChatMessage>) -> usize {
    resyncs_after_paged_load(pages(3, 5), full).await
}

async fn resyncs_after_paged_load(pages: Vec<Vec<ChatMessage>>, full: Vec<ChatMessage>) -> usize {
    let session = Arc::new(FakeSession {
        pager: FakePages {
            pages,
            ..Default::default()
        },
        history: full,
        ..Default::default()
    });
    let (deps, _) = manager(session);
    let surface = Arc::new(Resyncs::default());
    let manager = ChatManager::new(deps).with_chat_surface(surface.clone());
    assert!(manager.adapter_first_window("c1", 4).await.is_some());
    manager.load_chat("c1").await;
    surface.0.load(Ordering::SeqCst)
}

#[tokio::test]
async fn a_full_load_that_matches_the_window_does_not_resync() {
    let full: Vec<_> = (0..15).map(|n| message(&format!("m{n}"))).collect();

    assert_eq!(resyncs_after_window_then_load(full).await, 0);
}

#[tokio::test]
async fn a_full_load_that_differs_from_the_window_resyncs() {
    let mut full: Vec<_> = (0..15).map(|n| message(&format!("m{n}"))).collect();
    full.push(message("late"));

    assert_eq!(resyncs_after_window_then_load(full).await, 1);
}

/// 15 messages whose newest is a tool call nothing answered, and their pages.
fn gated_history() -> (Vec<Vec<ChatMessage>>, Vec<ChatMessage>) {
    let mut full: Vec<_> = (0..15).map(|n| message(&format!("m{n}"))).collect();
    full[14] = serde_json::from_value(json!({"id":"m14","chatId":"c1","type":"assistant",
        "timestamp":"2026-11-27T00:00:00Z",
        "content":[{"type":"tool_use","id":"pending-call","name":"Bash","input":{"command":"pwd"}}]}))
    .unwrap();
    let pages = vec![
        full[10..].to_vec(),
        full[5..10].to_vec(),
        full[..5].to_vec(),
    ];
    (pages, full)
}

#[tokio::test]
async fn a_full_load_that_restores_a_permission_gate_resyncs_and_the_next_resume_carries_it() {
    // The full load restores the call as a pending gate, which a window from
    // pages never carries: the client must replay, and that replay has it.
    let (pages, full) = gated_history();
    let session = Arc::new(FakeSession {
        pager: FakePages {
            pages,
            ..Default::default()
        },
        history: full,
        ..Default::default()
    });
    let (deps, _) = manager(session);
    let surface = Arc::new(Resyncs::default());
    let manager = ChatManager::new(deps).with_chat_surface(surface.clone());
    let window = manager.adapter_first_window("c1", 4).await.unwrap();
    assert!(window.messages.iter().any(|m| m.id == "m14"));

    manager.load_chat("c1").await;

    assert_eq!(surface.0.load(Ordering::SeqCst), 1);
    let replay = manager.get_resume_snapshot("c1").await;
    assert_eq!(
        replay.pending.map(|gate| gate.tool_use_id).as_deref(),
        Some("pending-call")
    );
}

#[tokio::test]
async fn a_pending_gate_or_a_session_that_will_not_page_keeps_the_full_restore() {
    let (_, declined) = manager(session(Vec::new()));
    assert!(!declined.adapter_window_candidate("c1").await);

    let (_, gated) = manager(session(pages(3, 5)));
    assert!(gated.adapter_window_candidate("c1").await);
    gated
        .shared
        .permissions
        .lock()
        .unwrap()
        .restore_pending_permission("c1", &gated_history().1);
    assert!(!gated.adapter_window_candidate("c1").await);
}

#[path = "chat_manager_tests_claude_tail.rs"]
mod claude_tail;
