//! Which read a refresh asks the session for.
use super::*;
use super::{cold_manager, run_a_turn};
use serde_json::json;

fn history() -> ChatMessage {
    serde_json::from_value(json!({"id":"m1","chatId":"c1","type":"assistant",
        "timestamp":"2026-10-02T00:00:00Z","content":[{"type":"text","text":"hello"}]}))
    .unwrap()
}

#[tokio::test]
async fn only_the_background_refresh_asks_for_the_capped_read() {
    let dir = tempfile::tempdir().unwrap();
    let (deps, manager, transcript) = cold_manager(&dir).await;
    let background = Arc::new(AtomicUsize::new(0));
    deps.set_session_to_return(Arc::new(crate::test_support::FakeSession {
        history: vec![history()],
        history_loads: Some(deps.adapters.history_loads.clone()),
        background_loads: Some(background.clone()),
        history_sources: vec![transcript.clone()],
        ..Default::default()
    }));
    manager.load_chat("c1").await;
    let loads = deps.adapters.history_loads.load(Ordering::SeqCst);
    assert_eq!(background.load(Ordering::SeqCst), 0, "a cold open is foreground");

    run_a_turn(&deps, &transcript).await;
    manager.refresh_history_cache_as("c1", true).await.unwrap();
    assert_eq!(background.load(Ordering::SeqCst), 1, "turn-end refresh is capped");
    assert_eq!(deps.adapters.history_loads.load(Ordering::SeqCst), loads + 1);

    run_a_turn(&deps, &transcript).await;
    manager.refresh_history_cache_as("c1", false).await.unwrap();
    assert_eq!(background.load(Ordering::SeqCst), 1, "the shutdown flush is not");
    assert_eq!(deps.adapters.history_loads.load(Ordering::SeqCst), loads + 2);
}
