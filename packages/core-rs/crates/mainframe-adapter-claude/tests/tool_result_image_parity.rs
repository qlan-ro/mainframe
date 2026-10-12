//! A `tool_result` carrying image blocks produces the same `ToolResult`
//! (content + images) whether it arrives live through `events::handle_stdout`
//! or via history reload's `history_converters::convert_history_entry` —
//! modelled on `live_vs_history_id_parity.rs`.
#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    reason = "Test assertions and scenarios"
)]

use std::sync::{Arc, Mutex};

use mainframe_adapter_api::SessionSink;
use mainframe_adapter_claude::events::handle_stdout;
use mainframe_adapter_claude::history_converters::convert_history_entry;
use mainframe_adapter_claude::session::ClaudeSession;
use mainframe_background_tasks::tracker::BackgroundTaskTracker;
use mainframe_claude_workflows::store::ClaudeWorkflowStore;
use mainframe_types::adapter::{ProviderQuota, SessionOptions};
use mainframe_types::chat::{ChatMessageType, MessageContent, MessageContentNode};
use serde_json::{Value, json};

/// Captures the content passed to `on_tool_result` — the live-path
/// equivalent of a history `ToolResult` `ChatMessage`'s content.
#[derive(Default)]
struct ToolResultRecordingSink {
    tool_result_content: Mutex<Option<Vec<MessageContent>>>,
}

impl SessionSink for ToolResultRecordingSink {
    mainframe_adapter_api::forward_session_sink!(on_init, on_result);

    mainframe_adapter_api::forward_session_sink!(
        on_message,
        on_permission,
        on_exit,
        on_error,
        on_compact,
        on_compact_start,
        on_context_usage,
        on_plan_file,
        on_skill_file,
        on_queued_processed,
        on_todo_update,
        on_pr_detected,
        on_cli_message,
        on_skill_loaded,
        on_subagent_child
    );

    fn on_tool_result(&self, content: Vec<MessageContent>, _vendor_id: Option<String>) {
        *self.tool_result_content.lock().unwrap() = Some(content);
    }
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
/// PNG image block — the `Read`-of-a-screenshot shape.
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
