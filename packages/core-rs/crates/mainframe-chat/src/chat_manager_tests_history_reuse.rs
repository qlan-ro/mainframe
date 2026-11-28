//! A full load right after a read of the same history (a resume that read it
//! before the lifecycle load) reuses what is in memory instead of reading again
//! (`lifecycle_manager/history.rs`).
use super::*;
use serde_json::json;
use std::path::PathBuf;
use std::sync::atomic::AtomicUsize;

fn history() -> ChatMessage {
    serde_json::from_value(json!({"id":"m1","chatId":"c1","type":"assistant",
        "timestamp":"2026-10-02T00:00:00Z","content":[{"type":"text","text":"hello"}]}))
    .unwrap()
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

async fn manager(dir: &tempfile::TempDir) -> (Arc<FakeDeps>, ChatManager, Arc<Resyncs>, PathBuf) {
    let transcript = dir.path().join("session.jsonl");
    tokio::fs::write(&transcript, "{\"line\":1}\n")
        .await
        .unwrap();
    let mut chat = test_chat("c1");
    chat.vendor_session_id = Some("session".into());
    let deps = FakeDeps::with_chats(vec![chat]);
    *deps.adapters.history.lock().unwrap() = Some(vec![history()]);
    *deps.adapters.transcript_present.lock().unwrap() = Some(true);
    deps.set_history_sources(vec![transcript.clone()]);
    deps.set_history_cache_dir(&dir.path().join("cache").to_string_lossy());
    let surface = Arc::new(Resyncs::default());
    let manager = ChatManager::new(deps.clone()).with_chat_surface(surface.clone());
    (deps, manager, surface, transcript)
}

#[tokio::test]
async fn a_full_load_after_a_read_reuses_the_history_in_memory_without_a_resync() {
    let dir = tempfile::tempdir().unwrap();
    let (deps, manager, surface, _) = manager(&dir).await;
    manager.get_messages("c1").await;
    assert_eq!(deps.adapters.history_loads.load(Ordering::SeqCst), 1);

    manager.load_chat("c1").await;

    assert_eq!(
        deps.adapters.history_loads.load(Ordering::SeqCst),
        1,
        "no second read"
    );
    assert_eq!(surface.0.load(Ordering::SeqCst), 0);
    assert!(manager.is_chat_loaded("c1"));
}

#[tokio::test]
async fn a_transcript_changed_since_the_read_is_read_again() {
    let dir = tempfile::tempdir().unwrap();
    let (deps, manager, _, transcript) = manager(&dir).await;
    manager.get_messages("c1").await;
    tokio::fs::write(&transcript, "{\"line\":1}\n{\"line\":2}\n")
        .await
        .unwrap();

    manager.load_chat("c1").await;

    assert_eq!(deps.adapters.history_loads.load(Ordering::SeqCst), 2);
}

#[tokio::test]
async fn a_history_changed_in_memory_since_the_read_is_read_again_and_resyncs() {
    // A live change (here a transient message) moves the cache's generation:
    // the full load must not take the changed cache for the transcript.
    let dir = tempfile::tempdir().unwrap();
    let (_, manager, surface, _) = manager(&dir).await;
    manager.get_messages("c1").await;
    let transient: ChatMessage = serde_json::from_value(json!({"id":"t1","chatId":"c1",
        "type":"assistant","timestamp":"2026-10-02T00:00:01Z","content":[{"type":"text","text":"live"}]}))
    .unwrap();
    manager
        .shared
        .messages
        .lock()
        .unwrap()
        .append("c1", transient);

    manager.load_chat("c1").await;

    assert_eq!(surface.0.load(Ordering::SeqCst), 1);
    assert_eq!(
        manager.shared.messages.lock().unwrap().get("c1").cloned(),
        Some(vec![history()])
    );
}

#[tokio::test]
async fn a_reused_history_hands_the_scan_the_files_its_read_collected() {
    let dir = tempfile::tempdir().unwrap();
    let (deps, manager, _, _) = manager(&dir).await;
    let files = mainframe_adapter_api::CollectedHistoryFiles {
        plans: vec!["plan.md".into()],
        ..Default::default()
    };
    *deps.adapters.scan.collects.lock().unwrap() = Some(files.clone());
    manager.get_messages("c1").await;

    manager.load_chat("c1").await;

    assert_eq!(deps.adapters.history_loads.load(Ordering::SeqCst), 1);
    assert_eq!(*deps.adapters.scan.scanned.lock().unwrap(), [Some(files)]);
}
