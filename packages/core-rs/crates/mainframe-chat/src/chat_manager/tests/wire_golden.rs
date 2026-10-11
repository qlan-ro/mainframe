use super::*;

#[tokio::test]
async fn enriched_chat_events_match_baseline_wire_bytes() {
    let deps = StoreDeps::arc();
    let manager = ChatManager::new(deps.clone());
    let mut chat = test_chat("wire-chat");
    chat.no_project = true;
    for event in [
        DaemonEvent::ChatCreated {
            chat: chat.clone(),
            source: None,
        },
        DaemonEvent::ChatUpdated { chat, reason: None },
        DaemonEvent::ChatEnded {
            chat_id: "wire-chat".into(),
        },
        DaemonEvent::ChatOffloaded {
            chat_id: "wire-chat".into(),
        },
    ] {
        manager.emit(event);
    }
    manager.dispose();
    let wire = serde_json::to_string(&deps.events()).unwrap();
    assert_eq!(wire, include_str!("wire_events.txt").trim());
}
