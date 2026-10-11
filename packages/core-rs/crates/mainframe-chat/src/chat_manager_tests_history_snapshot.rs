//! The history snapshot cache end to end through a real `ChatManager`
//! (`history_cache.rs` has the unit tests; this proves `get_messages`'s cold
//! path consults and refreshes it). The manager's in-memory cache is kept
//! fully pinned by other chats (same trick as `history_eviction`), so every
//! `get_messages("c1")` is a cold load and the only thing that can stop it
//! from calling `load_history` again is a snapshot hit.
use super::*;
use serde_json::json;
use std::path::PathBuf;

fn history() -> ChatMessage {
    serde_json::from_value(json!({"id":"m1","chatId":"c1","type":"assistant",
        "timestamp":"2026-10-02T00:00:00Z","content":[{"type":"text","text":"hello"}]}))
    .unwrap()
}

/// A manager whose `c1` always loads cold, backed by one stat-able fake
/// transcript file and a cache dir this test alone owns.
async fn cold_manager(dir: &tempfile::TempDir) -> (Arc<FakeDeps>, ChatManager, PathBuf) {
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
    let manager = ChatManager::new(deps.clone());
    {
        let mut cache = manager.shared.messages.lock().unwrap();
        for id in 0..50 {
            let chat_id = format!("pinned-{id}");
            cache.pin(&chat_id);
            cache.set(&chat_id, vec![history()]);
        }
    }
    (deps, manager, transcript)
}

#[tokio::test]
async fn a_second_cold_load_of_an_unchanged_transcript_hits_the_snapshot() {
    let dir = tempfile::tempdir().unwrap();
    let (deps, manager, _) = cold_manager(&dir).await;

    assert_eq!(manager.get_messages("c1").await, vec![history()]);
    assert_eq!(deps.adapters.history_loads.load(Ordering::SeqCst), 1);
    manager.history_cache.flush().await;
    assert!(manager.shared.messages.lock().unwrap().get("c1").is_none());

    assert_eq!(manager.get_messages("c1").await, vec![history()]);
    assert_eq!(
        deps.adapters.history_loads.load(Ordering::SeqCst),
        1,
        "an unchanged transcript must be served from the snapshot, not reparsed"
    );
}

#[tokio::test]
async fn a_changed_transcript_misses_the_snapshot_and_reparses() {
    let dir = tempfile::tempdir().unwrap();
    let (deps, manager, transcript) = cold_manager(&dir).await;

    manager.get_messages("c1").await;
    manager.history_cache.flush().await;

    // Grow the file: a new length is a fingerprint miss on its own, without
    // depending on mtime granularity.
    tokio::fs::write(&transcript, "{\"line\":1}\n{\"line\":2}\n")
        .await
        .unwrap();
    assert_eq!(manager.get_messages("c1").await, vec![history()]);
    assert_eq!(
        deps.adapters.history_loads.load(Ordering::SeqCst),
        2,
        "a changed transcript must be reparsed"
    );
}

#[tokio::test]
async fn a_session_without_history_sources_never_touches_the_cache() {
    let dir = tempfile::tempdir().unwrap();
    let (deps, manager, _) = cold_manager(&dir).await;
    deps.set_history_sources(Vec::new());

    manager.get_messages("c1").await;
    manager.get_messages("c1").await;
    manager.history_cache.flush().await;
    assert_eq!(deps.adapters.history_loads.load(Ordering::SeqCst), 2);
    assert!(
        tokio::fs::metadata(dir.path().join("cache")).await.is_err(),
        "no snapshot dir should appear for an adapter that opted out"
    );
}
