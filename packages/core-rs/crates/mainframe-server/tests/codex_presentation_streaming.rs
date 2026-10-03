#![allow(clippy::unwrap_used, clippy::expect_used)]
#[path = "codex_presentation_streaming/support.rs"]
mod support;
use mainframe_acp::encoder::{EncodedItem, encode_revision};
use mainframe_adapter_api::SessionSink;
use mainframe_adapter_codex::event_mapper::{CodexSessionState, handle_notification};
use mainframe_chat::{
    event_handler::EventHandler, message_cache::MessageCache, permission_manager::PermissionManager,
};
use serde_json::{Value, json};
use std::sync::{Arc, Mutex};
use support::*;
struct Harness {
    cache: Arc<Mutex<MessageCache>>,
    handler: EventHandler<Deps>,
    sink: Arc<dyn SessionSink>,
    state: CodexSessionState,
    surface: Arc<RevisionSurface>,
}
impl Harness {
    fn new() -> Self {
        let cache = Arc::new(Mutex::new(MessageCache::new()));
        let handler = EventHandler::new(
            cache.clone(),
            Arc::new(Mutex::new(PermissionManager::new())),
            Arc::new(Deps),
        );
        let surface = Arc::new(RevisionSurface::default());
        handler.set_chat_surface(surface.clone());
        let sink = handler.build_sink("chat", Some("session".into()));
        let mut h = Self {
            cache,
            handler,
            sink,
            state: CodexSessionState::default(),
            surface,
        };
        h.state.agent_message_partial.emit_interval_ms = 0;
        h.send("thread/started", json!({"thread":{"id":"parent"}}));
        h.send(
            "turn/started",
            json!({"threadId":"parent","turn":{"id":"turn"}}),
        );
        h
    }
    fn send(&mut self, method: &str, p: Value) {
        handle_notification(method, &p, &self.sink, &mut self.state);
    }
    fn item(&mut self, event: &str, thread: &str, id: &str, text: &str, phase: &str) {
        self.send(event,json!({"threadId":thread,"turnId":"turn","item":{"id":id,"type":"agentMessage","text":text,"phase":phase}}));
    }
    fn delta(&mut self, text: &str) {
        self.send(
            "item/agentMessage/delta",
            json!({"threadId":"parent","turnId":"turn","itemId":"answer","delta":text}),
        );
    }
    fn encoded(&self) -> Vec<EncodedItem> {
        let (m, s) = self.surface.revisions().pop().unwrap();
        encode_revision(&m, s)
    }
}
fn sources(items: &[EncodedItem]) -> Vec<Value> {
    items
        .iter()
        .flat_map(|i| {
            let meta = match i {
                EncodedItem::Message { meta, .. }
                | EncodedItem::Thought { meta, .. }
                | EncodedItem::ToolCall { meta, .. } => meta,
            };
            meta.as_ref()
                .and_then(|v| v["_mainframe.dev"]["presentationSources"]["sources"].as_array())
                .cloned()
                .unwrap_or_default()
        })
        .collect()
}
#[test]
fn child_completion_preserves_parent_overlay_and_final_source_identity() {
    let mut h = Harness::new();
    h.send("item/completed",json!({"threadId":"parent","turnId":"turn","item":{"type":"subAgentActivity","id":"spawn","kind":"started","agentThreadId":"child","agentPath":"/root/child"}}));
    h.send(
        "turn/started",
        json!({"threadId":"child","turn":{"id":"turn"}}),
    );
    h.item("item/started", "parent", "answer", "", "final_answer");
    h.delta("Hello");
    let before = h.handler.current_overlay_message("chat").unwrap();
    h.item(
        "item/completed",
        "child",
        "child-answer",
        "child done",
        "final_answer",
    );
    assert_eq!(h.handler.current_overlay_message("chat"), Some(before));
    h.delta(" world");
    let partial = h.encoded();
    let p = sources(&partial);
    assert!(p.iter().any(|s| s["sourceMessageId"] == "answer"
        && s["streaming"] == true
        && s["presentation"]["finalEligible"] == true));
    assert!(p.iter().any(|s| s["sourceMessageId"] == "child-answer"
        && s["presentation"]["parentToolUseId"].is_string()));
    h.item(
        "item/completed",
        "parent",
        "answer",
        "Hello world",
        "final_answer",
    );
    assert!(h.handler.current_overlay_message("chat").is_none());
    let final_items = h.encoded();
    let p = sources(&final_items);
    assert_eq!(
        p.iter()
            .filter(|s| s["sourceMessageId"] == "answer")
            .count(),
        1
    );
    assert!(
        p.iter()
            .any(|s| s["sourceMessageId"] == "answer" && s["streaming"] == false)
    );
}
#[test]
fn child_completion_preserves_parent_overlay_with_or_without_item_turn() {
    for turn in [Some("turn"), None] {
        let mut h = Harness::new();
        h.send("item/completed",json!({"threadId":"parent","turnId":"turn","item":{"type":"subAgentActivity","id":"spawn","kind":"started","agentThreadId":"child","agentPath":"/root/child"}}));
        h.item("item/started", "parent", "answer", "", "final_answer");
        h.delta("Hello");
        let before = h.handler.current_overlay_message("chat").unwrap();
        let mut completed = json!({"threadId":"child","item":{
            "id":"child-answer","type":"agentMessage","text":"child done","phase":"final_answer"
        }});
        if let Some(turn) = turn {
            completed["turnId"] = json!(turn);
        }
        h.send("item/completed", completed);
        assert_eq!(
            h.handler.current_overlay_message("chat"),
            Some(before),
            "turn: {turn:?}"
        );
        h.delta(" world");
        h.item(
            "item/completed",
            "parent",
            "answer",
            "Hello world",
            "final_answer",
        );
        assert!(h.handler.current_overlay_message("chat").is_none());
    }
}
#[tokio::test]
async fn work_and_final_provenance_survive_full_cursor_and_continued_streaming() {
    let mut h = Harness::new();
    h.item(
        "item/completed",
        "parent",
        "comment",
        "🦀work",
        "commentary",
    );
    h.send("item/completed",json!({"threadId":"parent","turnId":"turn","item":{"id":"cmd","type":"commandExecution","command":"pwd","aggregatedOutput":"/tmp","status":"completed","exitCode":0}}));
    h.item("item/started", "parent", "answer", "", "final_answer");
    h.delta("Answer");
    let items = h.encoded();
    let (messages, streaming) = h.surface.revisions().pop().unwrap();
    let snapshot = Snapshot(messages, streaming);
    let full = replay(&snapshot, json!({"type":"start"})).await;
    let cursor = replay(&snapshot, json!({"type":"item","itemId":items[0].id()})).await;
    assert_eq!(full.items, items);
    assert_eq!(cursor.items, items);
    assert!(cursor.updates.len() < full.updates.len());
    let mut resumed = mainframe_acp::stream::SessionStream::new(0);
    resumed.seed(&full.items);
    assert!(resumed.on_revision(&items, 0, None).is_empty());
    h.delta(" grows");
    let growing = h.encoded();
    assert!(!resumed.on_revision(&growing, 1, None).is_empty());
    assert_eq!(
        sources(&growing)
            .iter()
            .filter(|s| s["sourceMessageId"] == "answer")
            .count(),
        1
    );
    h.item(
        "item/completed",
        "parent",
        "answer",
        "Answer grows",
        "final_answer",
    );
    assert_legacy_parity(&h);
}
fn assert_legacy_parity(h: &Harness) {
    let mut raw = h.cache.lock().unwrap().get("chat").unwrap().clone();
    for m in &mut raw {
        if let Some(meta) = &mut m.metadata {
            meta.remove("transcriptPresentation");
        }
    }
    let display = mainframe_adapter_claude::messages::display_pipeline::prepare_messages_for_client(
        &raw, None,
    );
    let mut legacy = encode_revision(&display, None);
    let mut actual = h.encoded();
    for item in actual.iter_mut().chain(legacy.iter_mut()) {
        let meta = match item {
            EncodedItem::Message { meta, .. }
            | EncodedItem::Thought { meta, .. }
            | EncodedItem::ToolCall { meta, .. } => meta,
        };
        if let Some(v) = meta {
            let meta = v["_mainframe.dev"].as_object_mut().unwrap();
            meta.remove("presentationSources");
            if meta.get("messageMeta") == Some(&json!({})) {
                meta.remove("messageMeta");
            }
        }
    }
    assert_eq!(actual, legacy);
}
#[test]
fn adjacent_commentary_and_final_keep_the_same_native_text_container() {
    let mut h = Harness::new();
    h.item(
        "item/completed",
        "parent",
        "comment",
        "🦀work",
        "commentary",
    );
    h.item(
        "item/completed",
        "parent",
        "answer",
        "e\u{301}final",
        "final_answer",
    );
    let items = h.encoded();
    assert_eq!(items.len(), 1);
    assert_eq!(items[0].id(), "comment");
    let p = sources(&items);
    assert_eq!(p.len(), 2);
    assert_eq!(p[0]["sourceMessageId"], "comment");
    assert_eq!(p[1]["sourceMessageId"], "answer");
    assert_eq!(p[0]["target"]["endUtf16"], 6);
    assert_eq!(p[1]["target"]["startUtf16"], 6);
    assert_legacy_parity(&h);
}

#[test]
fn nonempty_legacy_message_metadata_survives_presentation_transport() {
    let mut h = Harness::new();
    h.sink.on_message(
        serde_json::from_value(json!([{"type":"text","text":"legacy"}])).unwrap(),
        Some(mainframe_types::adapter::MessageMetadata {
            vendor_id: Some("legacy".into()),
            model: Some("keep-model".into()),
            usage: None,
        }),
    );
    h.item(
        "item/completed",
        "parent",
        "answer",
        "final",
        "final_answer",
    );
    let items = h.encoded();
    let EncodedItem::Message {
        meta: Some(meta), ..
    } = &items[0]
    else {
        panic!("message");
    };
    assert_eq!(meta["_mainframe.dev"]["messageMeta"]["model"], "keep-model");
    assert_legacy_parity(&h);
}
