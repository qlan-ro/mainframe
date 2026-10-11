use super::*;
use mainframe_types::content::LeafContent;

fn msg(id: &str) -> ChatMessage {
    ChatMessage {
        id: id.to_string(),
        chat_id: "c1".to_string(),
        r#type: ChatMessageType::User,
        content: vec![MessageContent::Leaf(LeafContent::Text {
            text: id.to_string(),
            parent_tool_use_id: None,
        })],
        timestamp: now_iso8601(),
        metadata: None,
    }
}

fn ids(cache: &MessageCache, chat_id: &str) -> Vec<String> {
    cache
        .get(chat_id)
        .unwrap()
        .iter()
        .map(|m| m.id.clone())
        .collect()
}

#[test]
fn moves_a_message_to_the_end_and_preserves_the_others_in_order() {
    let mut cache = MessageCache::new();
    cache.append("c1", msg("a"));
    cache.append("c1", msg("b"));
    cache.append("c1", msg("c"));
    assert!(cache.move_to_end("c1", "a"));
    assert_eq!(ids(&cache, "c1"), vec!["b", "c", "a"]);
}

#[test]
fn returns_false_for_an_unknown_chat_or_message() {
    let mut cache = MessageCache::new();
    cache.append("c1", msg("a"));
    assert!(!cache.move_to_end("c1", "missing"));
    assert!(!cache.move_to_end("nope", "a"));
}

#[test]
fn keeps_order_when_the_message_is_already_last() {
    let mut cache = MessageCache::new();
    cache.append("c1", msg("a"));
    cache.append("c1", msg("b"));
    assert!(cache.move_to_end("c1", "b"));
    assert_eq!(ids(&cache, "c1"), vec!["a", "b"]);
}

#[test]
fn append_never_drops_from_the_front() {
    let mut cache = MessageCache::new();
    for n in 0..2_500 {
        cache.append("c1", msg(&n.to_string()));
    }
    let expected: Vec<String> = (0..2_500).map(|n| n.to_string()).collect();
    assert_eq!(ids(&cache, "c1"), expected);
}

#[test]
fn set_keeps_every_message() {
    let mut cache = MessageCache::new();
    let messages: Vec<ChatMessage> = (0..2_500).map(|n| msg(&n.to_string())).collect();
    cache.set("c1", messages);
    assert_eq!(cache.get("c1").unwrap().len(), 2_500);
}

#[test]
fn eviction_skips_pinned_chats() {
    let mut cache = MessageCache::new();
    cache.pin("a");
    cache.set("a", vec![msg("a-1")]);
    for n in 0..50 {
        cache.set(&format!("chat-{n}"), vec![msg("m")]);
    }
    assert!(
        cache.get("a").is_some(),
        "the pinned chat survives eviction"
    );
    assert!(
        cache.get("chat-0").is_none(),
        "the oldest unpinned chat is evicted instead"
    );
}

#[test]
fn all_pinned_never_evicts() {
    let mut cache = MessageCache::new();
    for n in 0..51 {
        let id = format!("chat-{n}");
        cache.pin(&id);
        cache.set(&id, vec![msg("m")]);
    }
    for n in 0..51 {
        assert!(
            cache.get(&format!("chat-{n}")).is_some(),
            "chat-{n} must survive: every entry is pinned"
        );
    }
}

#[test]
fn release_unpins() {
    let mut cache = MessageCache::new();
    cache.pin("a");
    cache.set("a", vec![msg("a-1")]);
    cache.release("a");
    assert!(cache.get("a").is_none(), "release deletes the entry too");

    // Re-adding the same id proves `release` actually cleared the pin:
    // an un-pinned "a" is now the oldest key and is the first evicted.
    cache.set("a", vec![msg("a-2")]);
    for n in 0..50 {
        cache.set(&format!("chat-{n}"), vec![msg("m")]);
    }
    assert!(
        cache.get("a").is_none(),
        "a re-added, un-pinned chat is evictable again"
    );
}
