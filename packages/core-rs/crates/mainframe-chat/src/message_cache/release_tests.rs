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

fn assistant(id: &str) -> ChatMessage {
    ChatMessage {
        r#type: ChatMessageType::Assistant,
        ..message(id)
    }
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
fn output_that_reaches_disk_before_the_restore_reads_it_is_kept_once() {
    let mut cache = cache_with_history();
    cache.release_history("c1");

    cache.append_live("c1", "session", assistant("x"));
    cache.set("c1", vec![message("m1"), message("m2"), assistant("x")]);

    assert_eq!(ids(&cache), ["m1", "m2", "x"]);
}

#[test]
fn output_the_restore_read_missed_follows_the_restored_history() {
    let mut cache = cache_with_history();
    cache.release_history("c1");

    cache.append_live("c1", "session", assistant("x"));
    cache.set("c1", vec![message("m1"), message("m2")]);

    assert_eq!(ids(&cache), ["m1", "m2", "x"]);
}

#[test]
fn a_live_copy_of_a_restored_record_is_dropped_until_new_output_arrives() {
    let mut cache = cache_with_history();
    cache.release_history("c1");
    cache.set("c1", vec![message("m1"), message("m2"), assistant("x")]);

    cache.append_live("c1", "session", assistant("x"));
    cache.append_live("c1", "session", assistant("y"));
    cache.append("c1", message("m1"));

    assert_eq!(
        ids(&cache),
        ["m1", "m2", "x", "y", "m1"],
        "once new output arrived, appends are no longer reconciled"
    );
}

#[test]
fn a_daemon_notice_written_while_released_survives_the_restore() {
    let mut cache = cache_with_history();
    cache.release_history("c1");

    cache.append("c1", message("notice"));
    cache.set("c1", vec![message("m1"), message("m2")]);

    assert_eq!(ids(&cache), ["m1", "m2", "notice"]);
}

#[test]
fn nested_blocks_for_a_buffered_parent_wait_with_it() {
    use mainframe_types::chat::MessageContentNode;
    let mut cache = cache_with_history();
    cache.release_history("c1");
    let mut parent = assistant("x");
    parent.content = vec![MessageContent::Node(MessageContentNode::ToolUse {
        timing: None,
        command_execution: None,
        id: "tool-1".to_owned(),
        name: "Task".to_owned(),
        input: HashMap::new(),
        parent_tool_use_id: None,
    })];
    cache.append_live("c1", "session", parent);

    let child = message("child").content;
    assert!(cache.append_nested_live("c1", "session", "tool-1", child));
    assert!(!cache.append_nested_live("c1", "session", "on-disk", Vec::new()));
    cache.set("c1", vec![message("m1")]);

    assert_eq!(cache.get("c1").unwrap()[1].content.len(), 2);
}
