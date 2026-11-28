use super::*;
use mainframe_types::content::LeafContent;

fn message(id: &str) -> ChatMessage {
    ChatMessage {
        id: id.to_owned(),
        chat_id: "c1".to_owned(),
        r#type: ChatMessageType::User,
        content: vec![MessageContent::Leaf(LeafContent::Text {
            text: "synthetic".to_owned(),
            parent_tool_use_id: None,
        })],
        timestamp: now_iso8601(),
        metadata: None,
    }
}

fn cache_with_history() -> MessageCache {
    let mut cache = MessageCache::new();
    cache.pin("c1");
    cache.set("c1", vec![message("m1"), message("m2")]);
    cache
}

#[test]
fn release_drops_the_history_but_keeps_the_pin() {
    let mut cache = cache_with_history();

    assert!(cache.release_history("c1"));

    assert!(cache.get("c1").is_none());
    assert!(cache.is_released("c1"));
    assert!(
        cache.is_pinned("c1"),
        "the registry cell still pins the chat"
    );
    assert_eq!(cache.generation("c1"), None);
}

#[test]
fn release_of_a_chat_without_history_changes_nothing() {
    let mut cache = MessageCache::new();
    cache.pin("c1");

    assert!(!cache.release_history("c1"));
    assert!(!cache.is_released("c1"));
}

#[test]
fn an_append_to_a_released_chat_never_leaves_a_partial_history() {
    let mut cache = cache_with_history();
    cache.release_history("c1");

    cache.append("c1", message("m3"));
    cache.append_live("c1", "session", message("m4"));

    assert!(
        cache.get("c1").is_none(),
        "the transcript still holds the full list"
    );
    assert!(cache.is_released("c1"));
}

#[test]
fn storing_a_full_history_ends_the_release() {
    let mut cache = cache_with_history();
    cache.release_history("c1");

    cache.set("c1", vec![message("m1"), message("m2"), message("m3")]);
    cache.append("c1", message("m4"));

    assert!(!cache.is_released("c1"));
    assert_eq!(cache.get("c1").map(Vec::len), Some(4));
}

#[test]
fn leaving_the_cache_ends_the_release() {
    let mut deleted = cache_with_history();
    deleted.release_history("c1");
    deleted.delete("c1");
    assert!(!deleted.is_released("c1"));

    let mut unpinned = cache_with_history();
    unpinned.release_history("c1");
    unpinned.unpin("c1");
    assert!(!unpinned.is_released("c1"));
}

fn ids(cache: &MessageCache) -> Vec<String> {
    cache
        .get("c1")
        .map(|m| m.iter().map(|m| m.id.clone()).collect())
        .unwrap_or_default()
}

#[test]
fn a_history_read_never_installs_over_a_write_made_during_it() {
    let mut cache = cache_with_history();
    cache.release_history("c1");
    let read_from = cache.history_epoch("c1");

    // A send restores and appends while the older read is still running.
    cache.set("c1", vec![message("m1"), message("m2")]);
    cache.append("c1", message("prompt"));

    assert!(
        cache
            .install_history("c1", read_from, vec![message("m1"), message("m2")])
            .is_none()
    );
    assert_eq!(ids(&cache), ["m1", "m2", "prompt"]);
    let current = cache.history_epoch("c1");
    assert!(
        cache
            .install_history("c1", current, vec![message("m1")])
            .is_some()
    );
}

#[test]
fn a_release_clears_nothing_once_the_chat_was_used_after_the_decision() {
    let mut cache = cache_with_history();
    let seen = cache.activity("c1");
    cache.note_activity("c1");

    assert!(!cache.release_history_if_unused("c1", seen));
    assert!(cache.get("c1").is_some());
    let now = cache.activity("c1");
    assert!(cache.release_history_if_unused("c1", now));
    assert!(cache.is_released("c1"));
}
