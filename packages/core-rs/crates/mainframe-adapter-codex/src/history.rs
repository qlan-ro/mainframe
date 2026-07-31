//! Ported from `packages/core/src/plugins/builtin/codex/history.ts`.
//!
//! Hosts the crate-shared `MessageContent` block builders + the `with_parent`
//! tagger (reused by `event_mapper`); re-exports `convert_thread_items` (moved to
//! `history_convert.rs`, task 2, todo #247) and `parse_unified_diff` (moved to
//! `unified_diff.rs`) so external call sites keep compiling.

use std::collections::HashMap;

use mainframe_types::chat::{ChatMessage, ChatMessageType, DiffHunk, MessageContent};
use mainframe_types::content::LeafContent;
use serde_json::{Value, json};

use crate::item_types::PatchChangeKind;

pub use crate::history_convert::convert_thread_items;
pub(crate) use crate::unified_diff::parse_unified_diff;

/// Build a `ChatMessage` with a CALLER-SUPPLIED deterministic id (derived from the
/// Codex thread item's stable `id`), so reconstructing the same items yields the
/// same ids every turn (lets the display delta emitter detect appends/updates).
pub(crate) fn make_message(
    id: &str,
    chat_id: &str,
    r#type: ChatMessageType,
    content: Vec<MessageContent>,
) -> ChatMessage {
    ChatMessage {
        id: id.to_string(),
        chat_id: chat_id.to_string(),
        r#type,
        content,
        timestamp: mainframe_runtime::time::now_iso8601(),
        metadata: None,
    }
}

pub(crate) fn reasoning_text(summary: &[String], content: &[String]) -> String {
    let s = summary.join("\n");
    if s.is_empty() { content.join("\n") } else { s }
}

pub(crate) fn is_exec_error(exit_code: Option<i64>) -> bool {
    exit_code.map(|c| c != 0).unwrap_or(false)
}

pub(crate) fn bash_input(command: &str) -> HashMap<String, Value> {
    let mut m = HashMap::new();
    m.insert("command".to_string(), json!(command));
    m
}

pub(crate) fn file_change_input(
    is_add: bool,
    path: &str,
    diff: &str,
    kind: &PatchChangeKind,
) -> HashMap<String, Value> {
    let mut m = HashMap::new();
    m.insert("file_path".to_string(), json!(path));
    if is_add {
        m.insert("content".to_string(), json!(extract_added_content(diff)));
    } else {
        m.insert("old_string".to_string(), json!(""));
        m.insert("new_string".to_string(), json!(""));
        if let PatchChangeKind::Update {
            move_path: Some(mp),
        } = kind
        {
            m.insert("move_path".to_string(), json!(mp));
        }
    }
    m
}

pub(crate) fn mcp_result_content(
    content: Option<&Value>,
    error: Option<&crate::item_types::CodexItemError>,
) -> String {
    if let Some(err) = error {
        return err.message.clone();
    }
    // `JSON.stringify(item.result?.content ?? '')`
    let val = content
        .filter(|c| !c.is_null())
        .cloned()
        .unwrap_or(Value::String(String::new()));
    serde_json::to_string(&val).unwrap_or_default()
}

pub(crate) fn extract_added_content(diff: &str) -> String {
    diff.split('\n')
        .filter(|line| line.starts_with('+') && !line.starts_with("+++"))
        .map(|line| &line[1..])
        .collect::<Vec<_>>()
        .join("\n")
}

// ── Crate-shared MessageContent block builders (reused by event_mapper) ──────────

pub(crate) fn text_block(text: &str) -> MessageContent {
    MessageContent::Leaf(LeafContent::Text {
        text: text.to_string(),
        parent_tool_use_id: None,
    })
}

pub(crate) fn thinking_block(text: &str) -> MessageContent {
    MessageContent::Leaf(LeafContent::Thinking {
        thinking: text.to_string(),
        parent_tool_use_id: None,
    })
}

pub(crate) fn image_block(media_type: &str, data: &str) -> MessageContent {
    MessageContent::Leaf(LeafContent::Image {
        media_type: media_type.to_string(),
        data: data.to_string(),
        parent_tool_use_id: None,
    })
}

pub(crate) fn tool_use_block(
    id: &str,
    name: &str,
    input: HashMap<String, Value>,
) -> MessageContent {
    MessageContent::Node(mainframe_types::chat::MessageContentNode::ToolUse {
        id: id.to_string(),
        name: name.to_string(),
        input,
        parent_tool_use_id: None,
    })
}

pub(crate) fn tool_result_block(
    tool_use_id: &str,
    content: &str,
    is_error: bool,
    structured_patch: Option<Vec<DiffHunk>>,
) -> MessageContent {
    MessageContent::Node(mainframe_types::chat::MessageContentNode::ToolResult {
        tool_use_id: tool_use_id.to_string(),
        content: content.to_string(),
        is_error,
        structured_patch,
        original_file: None,
        modified_file: None,
        parent_tool_use_id: None,
    })
}

pub(crate) fn collab_agent_tool_use(
    id: &str,
    prompt: &str,
    description: &str,
    subagent_type: &str,
) -> MessageContent {
    let mut input = HashMap::new();
    input.insert("prompt".to_string(), json!(prompt));
    input.insert("description".to_string(), json!(description));
    input.insert("subagent_type".to_string(), json!(subagent_type));
    tool_use_block(id, "CollabAgent", input)
}

/// Tag a block with `parentToolUseId` (mirrors the TS `{ ...b, parentToolUseId }`).
pub(crate) fn with_parent(block: MessageContent, pid: &str) -> MessageContent {
    use mainframe_types::chat::MessageContentNode as N;
    let pid = Some(pid.to_string());
    match block {
        MessageContent::Leaf(LeafContent::Text { text, .. }) => {
            MessageContent::Leaf(LeafContent::Text {
                text,
                parent_tool_use_id: pid,
            })
        }
        MessageContent::Leaf(LeafContent::Thinking { thinking, .. }) => {
            MessageContent::Leaf(LeafContent::Thinking {
                thinking,
                parent_tool_use_id: pid,
            })
        }
        MessageContent::Leaf(LeafContent::Image {
            media_type, data, ..
        }) => MessageContent::Leaf(LeafContent::Image {
            media_type,
            data,
            parent_tool_use_id: pid,
        }),
        MessageContent::Leaf(LeafContent::SkillLoaded {
            skill_name,
            path,
            content,
            ..
        }) => MessageContent::Leaf(LeafContent::SkillLoaded {
            skill_name,
            path,
            content,
            parent_tool_use_id: pid,
        }),
        MessageContent::Node(N::ToolUse {
            id, name, input, ..
        }) => MessageContent::Node(N::ToolUse {
            id,
            name,
            input,
            parent_tool_use_id: pid,
        }),
        MessageContent::Node(N::ToolResult {
            tool_use_id,
            content,
            is_error,
            structured_patch,
            original_file,
            modified_file,
            ..
        }) => MessageContent::Node(N::ToolResult {
            tool_use_id,
            content,
            is_error,
            structured_patch,
            original_file,
            modified_file,
            parent_tool_use_id: pid,
        }),
        MessageContent::Node(N::PermissionRequest { request, .. }) => {
            MessageContent::Node(N::PermissionRequest {
                request,
                parent_tool_use_id: pid,
            })
        }
        MessageContent::Node(N::Error { message, .. }) => MessageContent::Node(N::Error {
            message,
            parent_tool_use_id: pid,
        }),
        MessageContent::Node(N::Compaction { .. }) => MessageContent::Node(N::Compaction {
            parent_tool_use_id: pid,
        }),
    }
}

// PORT STATUS: src/plugins/builtin/codex/history.ts (249 lines)
// confidence: medium
// todos: 1
// notes: BLOCKER — `parse_unified_diff` (now in unified_diff.rs) lives in a
// notes: crate-private shim (faithful copy of messages/parse-unified-diff.ts)
// notes: because mainframe_display::parse_unified_diff is still a skeleton; swap to
// notes: the canonical fn once that task lands (TODO(port)).
// notes: This file hosts the crate-shared MessageContent block builders + the
// notes: `with_parent` tagger (reused by event_mapper) to keep ONE canonical copy.
// notes: convert_thread_items (now in history_convert.rs) takes all 4 params
// notes: explicitly (TS defaulted the last two); the recursive child call passes an
// notes: empty agent-meta map, matching TS.
// notes: Tests in tests/history.rs — both codex/__tests__/history.test.ts (userMessage
// notes: shapes + id stability) AND src/__tests__/codex-history.test.ts (per-item-type
// notes: conversions), assertion-for-assertion.
// notes: task 2 (todo #247) carved convert_thread_items into history_convert.rs,
// notes: emit_collab_agent into history_collab.rs, and parse_unified_diff/
// notes: parse_hunk_header/parse_pair into unified_diff.rs; re-exported here so
// notes: external `history::X` call sites keep compiling.
