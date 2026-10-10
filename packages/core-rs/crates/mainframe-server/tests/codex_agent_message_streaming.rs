//! Todo #378, end-to-end runtime coverage: a real `EventHandler` sink wired
//! to the real display pipeline (the production `IncrementalProjector`), driven by
//! the Codex adapter's `handle_notification` replaying the captured
//! `item/agentMessage/delta` stream (codex-cli 0.155.1). Pins the
//! `DisplayRevision` → `encode_revision` transitions a live chat-surface
//! subscriber actually sees: growing streamed text, a single converged
//! completion under the same item id, and no overlay left behind.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::sync::{Arc, Mutex};

use mainframe_acp::encoder::{EncodedItem, encode_revision};
use mainframe_adapter_codex::event_mapper::{CodexSessionState, handle_notification};
use mainframe_chat::chat_surface::{ChatSurface, ChatSurfaceEvent};
use mainframe_chat::event_handler::{EventChatUpdate, EventHandler, EventHandlerDeps};
use mainframe_chat::message_cache::MessageCache;
use mainframe_chat::permission_manager::PermissionManager;
use mainframe_chat::types::ActiveChat;
use mainframe_types::acp::content::ContentBlock;
use mainframe_types::acp::extensions::MAINFRAME_META_NAMESPACE;
use mainframe_types::adapter::DetectedPr;
use mainframe_types::chat::{QueuedMessageRef, TodoItem};
use mainframe_types::context::SkillFileEntry;
use mainframe_types::display::{DisplayMessage, StreamingLeafKind, ToolCategories};
use mainframe_types::events::DaemonEvent;
use serde_json::Value;

const FIXTURE: &str = include_str!("fixtures/agent-message-delta-0.155.1.jsonl");
const CHAT_ID: &str = "chat-codex-378";
const SESSION_ID: &str = "codex-session-378";

/// A deps impl with every hook inert except `display_projector`, which
/// returns the production `IncrementalProjector` over the real shared
/// display pipeline (established fact: Codex chats run through it too,
/// `mainframe-server/src/chat_deps.rs`) — the thing this test actually needs
/// live, since the streaming determination
/// (`display_projection::streaming_leaf_kind`) depends on its output shape.
struct Deps;

impl EventHandlerDeps for Deps {
    fn get_active_chat(&self, _chat_id: &str) -> Option<Arc<Mutex<ActiveChat>>> {
        None
    }
    fn emit_event(&self, _event: DaemonEvent) {}
    fn get_tool_categories(&self, _chat_id: &str) -> Option<ToolCategories> {
        None
    }
    fn on_queued_processed(&self, _chat_id: &str, _uuid: &str) {}
    fn on_queued_cleared(&self, _chat_id: &str) {}
    fn get_queued_refs(&self, _chat_id: &str) -> Vec<QueuedMessageRef> {
        Vec::new()
    }
    fn display_projector(&self) -> Box<dyn mainframe_display::DisplayProjector> {
        Box::new(mainframe_adapter_claude::messages::incremental::IncrementalProjector::new())
    }
    fn strip_command_tags(&self, text: &str) -> String {
        text.to_string()
    }
    fn chats_update(&self, _chat_id: &str, _patch: &EventChatUpdate) {}
    fn projects_get_path(&self, _project_id: &str) -> Option<String> {
        None
    }
    fn initial_transcript_path(&self, _: &str, _: &str, _: &str) -> Option<String> {
        None
    }
    fn add_plan_file(&self, _chat_id: &str, _file_path: &str) -> bool {
        false
    }
    fn add_skill_file(&self, _chat_id: &str, _entry: &SkillFileEntry) -> bool {
        false
    }
    fn update_todos(&self, _chat_id: &str, _todos: &[TodoItem]) {}
    fn add_detected_prs(&self, _chat_id: &str, _prs: &[DetectedPr]) -> Vec<DetectedPr> {
        Vec::new()
    }
    fn should_notify_permission(&self, _tool_name: Option<&str>) -> bool {
        false
    }
    fn notify_task_complete(&self) -> bool {
        false
    }
    fn notify_session_error(&self) -> bool {
        false
    }
    fn notify_attention_request(&self) -> bool {
        false
    }
    fn tracker_end_all_running(&self, _chat_id: &str) {}
    fn workflow_runs_stop_all(&self, _chat_id: &str) {}
}

/// Records every `DisplayRevision`'s `(messages, streaming)` pair, in order.
#[derive(Default)]
struct RevisionSurface {
    revisions: Mutex<Vec<(Vec<DisplayMessage>, Option<StreamingLeafKind>)>>,
}

impl RevisionSurface {
    fn revisions(&self) -> Vec<(Vec<DisplayMessage>, Option<StreamingLeafKind>)> {
        self.revisions.lock().unwrap().clone()
    }
}

impl ChatSurface for RevisionSurface {
    fn on_chat_surface_event(&self, event: ChatSurfaceEvent) {
        if let ChatSurfaceEvent::DisplayRevision {
            delta, streaming, ..
        } = event
        {
            let messages = delta.snapshot.materialize();
            self.revisions.lock().unwrap().push((messages, streaming));
        }
    }
}

/// Whether `item`'s `_meta["_mainframe.dev"].streaming` is `true` (mirrors
/// `mainframe-acp`'s own `encoder/tests/streaming_tests.rs::item_streaming`,
/// not reusable here since that module is private to its crate).
fn item_streaming(item: &EncodedItem) -> bool {
    let meta = match item {
        EncodedItem::Message { meta, .. }
        | EncodedItem::Thought { meta, .. }
        | EncodedItem::ToolCall { meta, .. } => meta,
    };
    meta.as_ref()
        .and_then(|v| v.get(MAINFRAME_META_NAMESPACE))
        .and_then(|ns| ns.get("streaming"))
        .and_then(Value::as_bool)
        .unwrap_or(false)
}

fn item_text(item: &EncodedItem) -> String {
    let EncodedItem::Message { content, .. } = item else {
        panic!("expected a Message item, got {item:?}");
    };
    content
        .iter()
        .filter_map(|b| match b {
            ContentBlock::Text { text, .. } => Some(text.as_str()),
            _ => None,
        })
        .collect()
}

fn fixture_notifications() -> Vec<(String, Value)> {
    FIXTURE
        .lines()
        .filter(|l| !l.trim().is_empty())
        .map(|line| {
            let v: Value = serde_json::from_str(line).expect("capture line is valid JSON");
            let method = v
                .get("method")
                .and_then(Value::as_str)
                .expect("capture line has a method")
                .to_string();
            let params = v.get("params").cloned().unwrap_or(Value::Null);
            (method, params)
        })
        .collect()
}

#[test]
fn deltas_stream_then_converge_under_the_same_item_id_with_no_overlay_left_behind() {
    let cache = Arc::new(Mutex::new(MessageCache::new()));
    let permissions = Arc::new(Mutex::new(PermissionManager::new()));
    let handler = EventHandler::new(cache, permissions, Arc::new(Deps));
    let surface = Arc::new(RevisionSurface::default());
    handler.set_chat_surface(surface.clone());
    let sink = handler.build_sink(CHAT_ID, Some(SESSION_ID.to_string()));

    let mut state = CodexSessionState::default();
    state.agent_message_partial.emit_interval_ms = 0;
    for (method, params) in fixture_notifications() {
        handle_notification(&method, &params, &sink, &mut state);
    }

    let revisions = surface.revisions();
    let encoded: Vec<Vec<EncodedItem>> = revisions
        .iter()
        .map(|(messages, streaming)| encode_revision(messages, *streaming))
        .collect();

    // Every delta before `item/completed` opens exactly one streaming item.
    let streaming_revisions: Vec<&Vec<EncodedItem>> = encoded
        .iter()
        .filter(|items| items.len() == 1 && item_streaming(&items[0]))
        .collect();
    assert!(
        streaming_revisions.len() > 5,
        "expected multiple streaming revisions, got {}",
        streaming_revisions.len()
    );

    let item_id = "msg_09af3cd1fb9af459016ac02d5e043c87d295dc51cb4308f1b8";
    let mut prev_len = 0;
    for items in &streaming_revisions {
        let item = &items[0];
        assert_eq!(item.id(), item_id);
        let text = item_text(item);
        assert!(
            text.len() > prev_len,
            "streamed text must grow: previous len {prev_len}, now {text:?}"
        );
        prev_len = text.len();
    }

    // The revision after `item/completed`: same id, final text once, no
    // streaming flag — completion converges in place.
    let completed_text = "Rivers flow downhill toward the sea every single day.";
    let final_revision = encoded.last().expect("at least one revision recorded");
    assert_eq!(final_revision.len(), 1);
    assert_eq!(final_revision[0].id(), item_id);
    assert_eq!(item_text(&final_revision[0]), completed_text);
    assert!(
        !item_streaming(&final_revision[0]),
        "the completed message must not carry the streaming flag"
    );

    // No overlay survives turn/completed: the last revision IS the
    // completed-message revision (no later, different content followed it).
    assert_eq!(
        encoded.iter().rposition(|items| !items.is_empty()),
        Some(encoded.len() - 1)
    );
}
