#![allow(clippy::unwrap_used, clippy::expect_used)]
#[path = "claude_presentation_streaming/support.rs"]
mod support;
use mainframe_acp::encoder::{EncodedItem, encode_revision};
use mainframe_adapter_api::SessionSink;
use mainframe_adapter_claude::{events::handle_stdout, session::ClaudeSession};
use mainframe_chat::{
    event_handler::EventHandler, message_cache::MessageCache, permission_manager::PermissionManager,
};
use mainframe_types::adapter::SessionOptions;
use serde_json::{Value, json};
use std::sync::{Arc, Mutex};
use support::*;
struct Harness {
    cache: Arc<Mutex<MessageCache>>,
    handler: EventHandler<Deps>,
    sink: Arc<dyn SessionSink>,
    session: ClaudeSession,
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
        let session = ClaudeSession::new(
            SessionOptions {
                project_path: "/tmp".into(),
                chat_id: None,
                mainframe_chat_id: "chat".into(),
                session_file_path: None,
                fork_source: None,
            },
            None,
            Arc::new(mainframe_background_tasks::tracker::BackgroundTaskTracker::new()),
            Arc::new(mainframe_claude_workflows::store::ClaudeWorkflowStore::new()),
            mainframe_runtime::ResolvedPath::from_value("/usr/bin:/bin"),
        );
        Self {
            cache,
            handler,
            sink,
            session,
            surface,
        }
    }
    fn send(&self, event: Value) {
        handle_stdout(&self.session, format!("{event}\n").as_bytes(), &*self.sink);
    }
    fn assistant(&self, id: &str, uuid: &str, text: &str) {
        self.send(json!({"type":"assistant","session_id":"provider-session","uuid":uuid,"message":{"id":id,"model":"model","content":[{"type":"text","text":text}]}}));
    }
    fn stream(&self, event: Value) {
        self.send(json!({"type":"stream_event","session_id":"provider-session","event":event}));
    }
    fn finish(&self) {
        self.stream(json!({"type":"message_delta","delta":{"stop_reason":"end_turn"}}));
        self.send(json!({"type":"result","session_id":"provider-session","subtype":"success","is_error":false,"duration_ms":120}));
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
#[tokio::test]
async fn late_final_metadata_preserves_unicode_native_container_and_replay() {
    let h = Harness::new();
    h.assistant("work", "work-entry", "🦀work");
    h.stream(json!({"type":"message_start","message":{"id":"final"}}));
    h.assistant("final", "final-entry", "e\u{301}answer");
    let before = h.encoded();
    assert!(
        sources(&before)
            .iter()
            .all(|s| s["presentation"]["finalEligible"] == false)
    );
    h.finish();
    let after = h.encoded();
    assert_eq!(
        before.iter().map(EncodedItem::id).collect::<Vec<_>>(),
        after.iter().map(EncodedItem::id).collect::<Vec<_>>()
    );
    let p = sources(&after);
    assert!(p.iter().any(|s| s["sourceMessageId"] == "final"
        && s["presentation"]["finalEligible"] == true
        && s["presentation"]["state"] == "completed"));
    assert!(
        p.iter()
            .any(|s| s["sourceMessageId"] == "work" && s["presentation"]["phase"] == "work")
    );
    assert_legacy_parity(&h);
    let (messages, streaming) = h.surface.revisions().pop().unwrap();
    assert_eq!(
        replay(&Snapshot(messages, streaming), json!({"type":"start"}))
            .await
            .items,
        after
    );
}
#[test]
fn child_completion_does_not_take_parent_partial_or_final_membership() {
    let h = Harness::new();
    h.assistant("work", "work-entry", "working");
    h.stream(json!({"type":"message_start","message":{"id":"final"}}));
    h.stream(json!({"type":"content_block_start","content_block":{"type":"text"}}));
    h.stream(json!({"type":"content_block_delta","delta":{"type":"text_delta","text":"answer"}}));
    let before = h.handler.current_overlay_message("chat").unwrap();
    h.send(json!({"type":"assistant","parent_tool_use_id":"task","session_id":"provider-session","uuid":"child-entry","message":{"id":"child","stop_reason":"end_turn","content":[{"type":"text","text":"child"}]}}));
    assert_eq!(h.handler.current_overlay_message("chat"), Some(before));
    h.assistant("final", "final-entry", "answer continued");
    h.finish();
    assert!(h.handler.current_overlay_message("chat").is_none());
    let p = sources(&h.encoded());
    assert!(
        p.iter()
            .any(|s| s["sourceMessageId"] == "final" && s["presentation"]["finalEligible"] == true)
    );
    assert!(!p.iter().any(|s| s["sourceMessageId"] == "child"));
}
fn assert_legacy_parity(h: &Harness) {
    let mut raw = h.cache.lock().unwrap().get("chat").unwrap().clone();
    for m in &mut raw {
        if let Some(meta) = &mut m.metadata {
            meta.remove("transcriptPresentation");
        }
    }
    let display = mainframe_adapter_claude::messages::display_pipeline::prepare_messages_for_client(
        &raw,
        Some(&mainframe_types::display::ToolCategories {
            subagent: std::collections::HashSet::from(["Task".into()]),
            hidden: Default::default(),
            explore: Default::default(),
            progress: Default::default(),
        }),
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
