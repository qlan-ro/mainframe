use super::*;
use serde_json::json;

fn history() -> ChatMessage {
    serde_json::from_value(json!({"id":"history-call","chatId":"c1","type":"assistant",
        "timestamp":"2026-10-02T00:00:00Z","content":[{
            "type":"tool_use","id":"pending-call","name":"Bash","input":{"command":"pwd"},
            "timing":{"startedAt":1000}}]}))
    .unwrap()
}

fn fully_pinned_cache() -> (Arc<StoreDeps>, ChatManager) {
    let mut chat = test_chat("c1");
    chat.claude_session_id = Some("session".into());
    let deps = StoreDeps::with_chats(vec![chat]);
    *deps.history.lock().unwrap() = Some(vec![history()]);
    *deps.transcript_present.lock().unwrap() = Some(true);
    let manager = ChatManager::new(deps.clone());
    {
        let mut cache = manager.messages.lock().unwrap();
        for id in 0..50 {
            let chat_id = format!("pinned-{id}");
            cache.pin(&chat_id);
            cache.set(&chat_id, vec![history()]);
        }
    }
    (deps, manager)
}

#[tokio::test]
async fn cold_history_resume_survives_immediate_eviction_and_restores_permission() {
    let (deps, manager) = fully_pinned_cache();
    let (messages, pending) = manager.get_resume_snapshot("c1").await;
    assert_eq!(
        messages.iter().map(|m| m.id.as_str()).collect::<Vec<_>>(),
        ["history-call"]
    );
    let pending = pending.expect("history restores the unanswered tool call");
    assert_eq!(pending.tool_use_id, "pending-call");
    assert_eq!(pending.tool_name, "Bash");
    assert_eq!(pending.input["command"], "pwd");
    assert_eq!(deps.history_loads.load(Ordering::SeqCst), 1);
    let cache = manager.messages.lock().unwrap();
    assert!(cache.get("c1").is_none());
    for id in 0..50 {
        assert!(cache.get(&format!("pinned-{id}")).is_some());
    }
}

#[tokio::test]
async fn cold_history_read_survives_immediate_eviction_with_explicit_timing() {
    let (_, manager) = fully_pinned_cache();
    assert_eq!(manager.get_messages("c1").await, vec![history()]);
    assert!(manager.messages.lock().unwrap().get("c1").is_none());
}
