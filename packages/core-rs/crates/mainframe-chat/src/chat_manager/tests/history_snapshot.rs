//! The history snapshot cache end to end through a real `ChatManager`
//! (`history_cache.rs` has the unit tests; this proves `get_messages`'s cold
//! path consults and refreshes it). The manager's in-memory cache is kept
//! fully pinned by other chats (same trick as `history_eviction`), so every
//! `get_messages("c1")` is a cold load and the only thing that can stop it
//! from calling `load_history` again is a snapshot hit.
use super::*;
use serde_json::json;
use std::path::PathBuf;
use std::time::Duration;

fn history() -> ChatMessage {
    serde_json::from_value(json!({"id":"m1","chatId":"c1","type":"assistant",
        "timestamp":"2026-10-02T00:00:00Z","content":[{"type":"text","text":"hello"}]}))
    .unwrap()
}

/// A manager whose `c1` always loads cold, backed by one stat-able fake
/// transcript file and a cache dir this test alone owns.
async fn cold_manager(dir: &tempfile::TempDir) -> (Arc<StoreDeps>, ChatManager, PathBuf) {
    let transcript = dir.path().join("session.jsonl");
    tokio::fs::write(&transcript, "{\"line\":1}\n")
        .await
        .unwrap();
    let mut chat = test_chat("c1");
    chat.claude_session_id = Some("session".into());
    let deps = StoreDeps::with_chats(vec![chat]);
    *deps.history.lock().unwrap() = Some(vec![history()]);
    *deps.transcript_present.lock().unwrap() = Some(true);
    deps.set_history_sources(vec![transcript.clone()]);
    deps.set_history_cache_dir(&dir.path().join("cache").to_string_lossy());
    let manager = ChatManager::new(deps.clone());
    {
        let mut cache = manager.messages.lock().unwrap();
        for id in 0..50 {
            let chat_id = format!("pinned-{id}");
            cache.pin(&chat_id);
            cache.set(&chat_id, vec![history()]);
        }
    }
    (deps, manager, transcript)
}

/// The snapshot write is fire-and-forget, so wait for it rather than racing it.
async fn wait_for_snapshot(dir: &tempfile::TempDir) {
    let path = dir.path().join("cache").join("c1.json");
    for _ in 0..200 {
        if tokio::fs::metadata(&path).await.is_ok() {
            return;
        }
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
    panic!("snapshot never written to {}", path.display());
}

#[tokio::test]
async fn a_second_cold_load_of_an_unchanged_transcript_hits_the_snapshot() {
    let dir = tempfile::tempdir().unwrap();
    let (deps, manager, _) = cold_manager(&dir).await;

    assert_eq!(manager.get_messages("c1").await, vec![history()]);
    assert_eq!(deps.history_loads.load(Ordering::SeqCst), 1);
    wait_for_snapshot(&dir).await;
    assert!(manager.messages.lock().unwrap().get("c1").is_none());

    assert_eq!(manager.get_messages("c1").await, vec![history()]);
    assert_eq!(
        deps.history_loads.load(Ordering::SeqCst),
        1,
        "an unchanged transcript must be served from the snapshot, not reparsed"
    );
}

#[tokio::test]
async fn a_changed_transcript_misses_the_snapshot_and_reparses() {
    let dir = tempfile::tempdir().unwrap();
    let (deps, manager, transcript) = cold_manager(&dir).await;

    manager.get_messages("c1").await;
    wait_for_snapshot(&dir).await;

    // Grow the file: a new length is a fingerprint miss on its own, without
    // depending on mtime granularity.
    tokio::fs::write(&transcript, "{\"line\":1}\n{\"line\":2}\n")
        .await
        .unwrap();
    assert_eq!(manager.get_messages("c1").await, vec![history()]);
    assert_eq!(
        deps.history_loads.load(Ordering::SeqCst),
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
    assert_eq!(deps.history_loads.load(Ordering::SeqCst), 2);
    tokio::time::sleep(Duration::from_millis(20)).await;
    assert!(
        tokio::fs::metadata(dir.path().join("cache")).await.is_err(),
        "no snapshot dir should appear for an adapter that opted out"
    );
}
