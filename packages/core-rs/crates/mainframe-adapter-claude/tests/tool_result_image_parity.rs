//! Todo #363, plan task 3: a `tool_result` carrying image blocks produces the
//! same `ToolResult` (content + images) whether it arrives live through
//! `events::handle_stdout` or via history reload's
//! `history_converters::convert_history_entry` — modelled on
//! `live_vs_history_id_parity.rs`.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::sync::{Arc, Mutex};

use mainframe_adapter_api::{AdapterError, LoadedSkill, SessionSink};
use mainframe_adapter_claude::events::handle_stdout;
use mainframe_adapter_claude::history_converters::convert_history_entry;
use mainframe_adapter_claude::session::ClaudeSession;
use mainframe_background_tasks::tracker::BackgroundTaskTracker;
use mainframe_claude_workflows::store::ClaudeWorkflowStore;
use mainframe_types::adapter::{
    ContextUsage, ControlRequest, DetectedPr, MessageMetadata, ProviderQuota, SessionOptions,
    SessionResult,
};
use mainframe_types::chat::{ChatMessageType, MessageContent, MessageContentNode, TodoItem};
use mainframe_types::context::SkillFileEntry;
use serde_json::{Value, json};

/// Captures the content passed to `on_tool_result` — the live-path
/// equivalent of a history `ToolResult` `ChatMessage`'s content.
#[derive(Default)]
struct ToolResultRecordingSink {
    tool_result_content: Mutex<Option<Vec<MessageContent>>>,
}

impl SessionSink for ToolResultRecordingSink {
    fn on_init(&self, _session_id: &str) {}
    fn on_message(&self, _content: Vec<MessageContent>, _metadata: Option<MessageMetadata>) {}
    fn on_tool_result(&self, content: Vec<MessageContent>, _vendor_id: Option<String>) {
        *self.tool_result_content.lock().unwrap() = Some(content);
    }
    fn on_permission(&self, _request: ControlRequest) {}
    fn on_result(&self, _data: SessionResult) {}
    fn on_exit(&self, _code: Option<i32>) {}
    fn on_error(&self, _error: AdapterError) {}
    fn on_compact(&self, _vendor_id: Option<&str>) {}
    fn on_compact_start(&self) {}
    fn on_context_usage(&self, _usage: ContextUsage) {}
    fn on_plan_file(&self, _file_path: &str) {}
    fn on_skill_file(&self, _entry: SkillFileEntry) {}
    fn on_queued_processed(&self, _uuid: &str) {}
    fn on_todo_update(&self, _todos: Vec<TodoItem>) {}
    fn on_pr_detected(&self, _pr: DetectedPr) {}
    fn on_cli_message(&self, _text: &str) {}
    fn on_skill_loaded(&self, _entry: LoadedSkill) {}
    fn on_subagent_child(&self, _parent_tool_use_id: &str, _blocks: Vec<MessageContent>) {}
    fn on_provider_quota(&self, _adapter_id: &str, _quota: ProviderQuota) {}
}

fn session() -> Arc<ClaudeSession> {
    let s = Arc::new(ClaudeSession::new(
        SessionOptions {
            project_path: "/tmp".to_string(),
            chat_id: None,
            mainframe_chat_id: "test-chat-id".to_string(),
            session_file_path: None,
            fork_source: None,
        },
        None,
        Arc::new(BackgroundTaskTracker::new()),
        Arc::new(ClaudeWorkflowStore::new()),
        mainframe_runtime::ResolvedPath::from_value("/usr/bin:/bin"),
    ));
    s.init_weak();
    s
}

/// A user entry whose sole content is a `tool_result` carrying one base64
/// PNG image block — the `Read`-of-a-screenshot shape (todo #363).
fn image_tool_result_entry() -> Value {
    json!({
        "type": "user",
        "uuid": "entry-img-1",
        "message": {
            "role": "user",
            "content": [
                {
                    "type": "tool_result",
                    "tool_use_id": "toolu_read_png",
                    "is_error": false,
                    "content": [
                        {
                            "type": "image",
                            "source": { "type": "base64", "media_type": "image/png", "data": "AAAA" }
                        }
                    ]
                }
            ]
        }
    })
}

fn find_tool_result(blocks: &[MessageContent]) -> &MessageContentNode {
    blocks
        .iter()
        .find_map(|b| match b {
            MessageContent::Node(node @ MessageContentNode::ToolResult { .. }) => Some(node),
            _ => None,
        })
        .expect("expected a tool_result block")
}

#[test]
fn live_and_history_produce_the_same_tool_result_images() {
    let entry = image_tool_result_entry();

    // History path: the same reload conversion `AdapterSession::load_history` runs.
    let history_message =
        convert_history_entry(&entry, "c1", &mut std::collections::HashSet::new())
            .expect("a user entry with a tool_result must convert to a history ChatMessage");
    assert_eq!(history_message.r#type, ChatMessageType::ToolResult);
    let MessageContentNode::ToolResult {
        content: history_content,
        images: history_images,
        ..
    } = find_tool_result(&history_message.content)
    else {
        unreachable!("find_tool_result only returns ToolResult nodes");
    };

    // Live path: replay the identical JSON line through the same NDJSON
    // dispatch the CLI's stdout drives (`events::handle_stdout`).
    let session = session();
    let sink = ToolResultRecordingSink::default();
    let line = format!("{}\n", serde_json::to_string(&entry).unwrap());
    handle_stdout(&session, line.as_bytes(), &sink);
    let live_blocks = sink
        .tool_result_content
        .lock()
        .unwrap()
        .clone()
        .expect("on_tool_result must have fired");
    let MessageContentNode::ToolResult {
        content: live_content,
        images: live_images,
        ..
    } = find_tool_result(&live_blocks)
    else {
        unreachable!("find_tool_result only returns ToolResult nodes");
    };

    assert_eq!(live_content, history_content);
    assert_eq!(live_images, history_images);
    assert_eq!(live_images.len(), 1);
    assert_eq!(live_images[0].media_type, "image/png");
    assert_eq!(live_images[0].data, "AAAA");
    assert_eq!(live_content, "");
    assert!(!live_content.contains("AAAA"));
}
