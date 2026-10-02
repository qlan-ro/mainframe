use super::*;
use mainframe_types::chat::MessageContentNode;
use serde_json::{Value, json};

pub(crate) fn tool(id: &str) -> MessageContent {
    serde_json::from_value(json!({"type":"tool_use","id":id,"name":"Bash","input":{}})).unwrap()
}

pub(crate) fn result(id: &str, error: bool) -> MessageContent {
    serde_json::from_value(
        json!({"type":"tool_result","toolUseId":id,"content":"","isError":error}),
    )
    .unwrap()
}

pub(crate) fn timings(cache: &MessageCache, chat: &str) -> Vec<Value> {
    cache
        .get(chat)
        .unwrap()
        .iter()
        .flat_map(|m| &m.content)
        .filter(|b| matches!(b, MessageContent::Node(MessageContentNode::ToolUse { .. })))
        .map(|b| serde_json::to_value(b).unwrap()["timing"].clone())
        .collect()
}

#[test]
fn tool_timing_cache_history_preserves_known_timing_on_replacement() {
    let mut cache = MessageCache::new();
    let timed = serde_json::from_value(json!({"type":"tool_use","id":"a","name":"Bash","input":{},
        "timing":{"startedAt":1000,"completedAt":1200}}))
    .unwrap();
    let original =
        cache.create_transient_message("c", ChatMessageType::Assistant, vec![timed], None);
    cache.set("c", vec![original]);
    let replacement =
        cache.create_transient_message("c", ChatMessageType::Assistant, vec![tool("a")], None);
    cache.set("c", vec![replacement]);
    assert_eq!(
        timings(&cache, "c"),
        vec![json!({"startedAt":1000,"completedAt":1200})]
    );
}

fn live(cache: &mut MessageCache, chat: &str, session: &str, blocks: Vec<MessageContent>) {
    let message = cache.create_transient_message(chat, ChatMessageType::Assistant, blocks, None);
    cache.append_live(chat, session, message);
}

#[test]
fn tool_timing_cache_replay_keeps_timed_and_untimed_history_without_clock_reads() {
    use std::sync::{
        Arc,
        atomic::{AtomicU64, Ordering},
    };
    let calls = Arc::new(AtomicU64::new(0));
    let reads = calls.clone();
    let mut cache = MessageCache::with_clock(Arc::new(move || {
        reads.fetch_add(1, Ordering::SeqCst);
        9000
    }));
    let explicit = serde_json::from_value(
        json!({"type":"tool_use","id":"timed","name":"Bash","input":{},
        "timing":{"startedAt":1000,"completedAt":1200}}),
    )
    .unwrap();
    let history = cache.create_transient_message(
        "c",
        ChatMessageType::Assistant,
        vec![explicit, tool("old")],
        None,
    );
    cache.set("c", vec![history]);
    let snapshot = cache.get("c").unwrap().clone();
    cache.set("c", snapshot);
    assert_eq!(calls.load(Ordering::SeqCst), 0);
    live(&mut cache, "c", "s", vec![tool("timed"), tool("old")]);
    assert_eq!(
        timings(&cache, "c"),
        vec![
            json!({"startedAt":1000,"completedAt":1200}),
            Value::Null,
            json!({"startedAt":1000,"completedAt":1200}),
            Value::Null
        ]
    );
    assert_eq!(calls.load(Ordering::SeqCst), 1);
}

#[test]
fn tool_timing_cache_live_reload_preserves_active_completion_and_duplicates() {
    let mut cache = MessageCache::with_clock(std::sync::Arc::new(|| 1000));
    live(&mut cache, "c", "s", vec![tool("a")]);
    let replacement = cache.create_transient_message(
        "c",
        ChatMessageType::Assistant,
        vec![tool("a"), tool("a")],
        None,
    );
    cache.set("c", vec![replacement]);
    live(&mut cache, "c", "s", vec![result("a", false)]);
    assert_eq!(
        timings(&cache, "c"),
        vec![json!({"startedAt":1000,"completedAt":1000}); 2]
    );
}

#[test]
fn tool_timing_cache_release_delete_and_eviction_clear_only_matching_identities() {
    let mut cache = MessageCache::with_clock(std::sync::Arc::new(|| 1000));
    live(&mut cache, "pinned", "s", vec![tool("a")]);
    cache.pin("pinned");
    live(&mut cache, "old", "s", vec![tool("a")]);
    for id in 0..MAX_CHATS {
        live(&mut cache, &id.to_string(), "s", vec![tool("a")]);
    }
    assert!(cache.get("old").is_none());
    assert!(!cache.tool_timings.contains_key("old"));
    assert!(cache.tool_timings.contains_key("pinned"));
    cache.release("pinned");
    assert!(!cache.tool_timings.contains_key("pinned"));
    cache.delete("49");
    assert!(!cache.tool_timings.contains_key("49"));
    let old =
        cache.create_transient_message("old", ChatMessageType::Assistant, vec![tool("a")], None);
    cache.set("old", vec![old]);
    assert_eq!(timings(&cache, "old"), vec![Value::Null]);
}

#[test]
fn tool_timing_cache_same_call_id_in_different_chats_stays_independent() {
    use std::sync::{
        Arc,
        atomic::{AtomicU64, Ordering},
    };
    let clock = Arc::new(AtomicU64::new(1000));
    let now = clock.clone();
    let mut cache = MessageCache::with_clock(Arc::new(move || now.load(Ordering::SeqCst)));
    live(&mut cache, "one", "s", vec![tool("a")]);
    clock.store(1100, Ordering::SeqCst);
    live(&mut cache, "two", "s", vec![tool("a")]);
    clock.store(1200, Ordering::SeqCst);
    live(&mut cache, "one", "s", vec![result("a", false)]);
    assert_eq!(
        timings(&cache, "one"),
        vec![json!({"startedAt":1000,"completedAt":1200})]
    );
    assert_eq!(timings(&cache, "two"), vec![json!({"startedAt":1100})]);
}

#[test]
fn tool_timing_cache_replayed_explicit_running_history_can_finish_on_owning_exit() {
    let mut cache = MessageCache::with_clock(std::sync::Arc::new(|| 1200));
    let explicit =
        serde_json::from_value(json!({"type":"tool_use","id":"a","name":"Bash","input":{},
        "timing":{"startedAt":1000}}))
        .unwrap();
    let history =
        cache.create_transient_message("c", ChatMessageType::Assistant, vec![explicit], None);
    cache.set("c", vec![history]);
    live(&mut cache, "c", "s", vec![tool("a")]);
    assert!(!cache.finish_tool_calls("c", "obsolete"));
    assert!(cache.finish_tool_calls("c", "s"));
    assert_eq!(
        timings(&cache, "c"),
        vec![json!({"startedAt":1000,"completedAt":1200}); 2]
    );
}

#[test]
fn tool_timing_cache_history_fills_missing_completion_without_replacing_observations() {
    let mut cache = MessageCache::with_clock(std::sync::Arc::new(|| 1000));
    live(&mut cache, "c", "s", vec![tool("a")]);
    for completed in [1200, 9000] {
        let explicit =
            serde_json::from_value(json!({"type":"tool_use","id":"a","name":"Bash","input":{},
            "timing":{"startedAt":900,"completedAt":completed}}))
            .unwrap();
        let history =
            cache.create_transient_message("c", ChatMessageType::Assistant, vec![explicit], None);
        cache.set("c", vec![history]);
        assert_eq!(
            timings(&cache, "c"),
            vec![json!({"startedAt":1000,"completedAt":1200})]
        );
    }
}
