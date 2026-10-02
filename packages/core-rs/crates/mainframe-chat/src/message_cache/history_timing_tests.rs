use super::timing_tests::{result, timings, tool};
use super::*;
use serde_json::json;
use std::sync::{
    Arc,
    atomic::{AtomicU64, AtomicUsize, Ordering},
};

struct ReloadedCall {
    cache: MessageCache,
    now: Arc<AtomicU64>,
}

impl ReloadedCall {
    fn new() -> Self {
        let now = Arc::new(AtomicU64::new(1000));
        let reads = Arc::new(AtomicUsize::new(0));
        let clock = now.clone();
        let clock_reads = reads.clone();
        let mut cache = MessageCache::with_clock(Arc::new(move || {
            clock_reads.fetch_add(1, Ordering::SeqCst);
            clock.load(Ordering::SeqCst)
        }));
        let live =
            cache.create_transient_message("c", ChatMessageType::Assistant, vec![tool("a")], None);
        cache.append_live("c", "owner", live);
        let history = cache.create_transient_message(
            "c",
            ChatMessageType::Assistant,
            vec![
                tool("a"),
                result("a", false),
                tool("legacy"),
                result("legacy", false),
            ],
            None,
        );
        cache.set("c", vec![history]);
        assert_eq!(reads.load(Ordering::SeqCst), 1);
        assert_eq!(
            timings(&cache, "c"),
            vec![json!({"startedAt":1000}), serde_json::Value::Null]
        );
        Self { cache, now }
    }

    fn result(&mut self, session: &str, id: &str) {
        let message = self.cache.create_transient_message(
            "c",
            ChatMessageType::ToolResult,
            vec![result(id, false)],
            None,
        );
        self.cache.append_live("c", session, message);
    }

    fn assert_completed(&self) {
        assert_eq!(
            timings(&self.cache, "c"),
            vec![
                json!({"startedAt":1000,"completedAt":1200}),
                serde_json::Value::Null
            ]
        );
    }
}

#[test]
fn tool_timing_history_result_keeps_later_owning_result_possible() {
    let mut fixture = ReloadedCall::new();
    fixture.now.store(1100, Ordering::SeqCst);
    fixture.result("obsolete", "a");
    assert_eq!(timings(&fixture.cache, "c")[0], json!({"startedAt":1000}));
    fixture.now.store(1200, Ordering::SeqCst);
    fixture.result("owner", "a");
    fixture.assert_completed();
    fixture.now.store(9000, Ordering::SeqCst);
    fixture.result("owner", "a");
    fixture.result("owner", "legacy");
    fixture.cache.finish_tool_calls("c", "owner");
    fixture.assert_completed();
}

#[test]
fn tool_timing_history_result_keeps_later_owning_exit_possible() {
    let mut fixture = ReloadedCall::new();
    fixture.now.store(1100, Ordering::SeqCst);
    assert!(!fixture.cache.finish_tool_calls("c", "obsolete"));
    fixture.now.store(1200, Ordering::SeqCst);
    assert!(fixture.cache.finish_tool_calls("c", "owner"));
    fixture.assert_completed();
    fixture.now.store(9000, Ordering::SeqCst);
    assert!(!fixture.cache.finish_tool_calls("c", "owner"));
    fixture.result("owner", "a");
    fixture.assert_completed();
}

#[test]
fn tool_timing_history_snapshot_keeps_merged_values_when_cache_evicts_it() {
    let mut fixture = ReloadedCall::new();
    fixture.cache.pin("c");
    for id in 0..MAX_CHATS {
        let chat_id = format!("pinned-{id}");
        fixture.cache.pin(&chat_id);
        let message = fixture.cache.create_transient_message(
            &chat_id,
            ChatMessageType::Assistant,
            vec![tool("other")],
            None,
        );
        fixture.cache.set(&chat_id, vec![message]);
    }
    fixture.cache.unpin("c");
    let incoming = fixture.cache.create_transient_message(
        "c",
        ChatMessageType::Assistant,
        vec![tool("a")],
        None,
    );
    let snapshot = fixture.cache.set_and_snapshot("c", vec![incoming]);
    assert_eq!(
        serde_json::to_value(&snapshot[0].content[0]).unwrap()["timing"],
        json!({"startedAt":1000})
    );
    assert!(fixture.cache.get("c").is_none());
    assert!(!fixture.cache.tool_timings.contains_key("c"));
}
