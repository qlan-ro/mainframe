//! The canonical encoder (todo #350, plan task 12): `DisplayMessage[] → ACP
//! item list`. Pure function — same input always produces the same output —
//! so live streaming and history replay encode identically by construction
//! (plan criterion 10), and the diff engine (`session_state.rs`, task 13)
//! can be tested by feeding it two encoder snapshots directly.
//!
//! Subagent/task content (`DisplayNode::TaskGroup`) flattens to tool-call
//! items carrying a `_meta` parent relation instead of nesting — the facade
//! has no `task_group` (criterion 10). Interleaved text/tool-call ordering
//! within one `DisplayMessage` is not preserved: ACP addresses a message by
//! its stable id, not by stream position, so every text/thinking leaf under
//! one container id accumulates into a single item.

use std::collections::HashMap;

use mainframe_types::content::LeafContent;
use mainframe_types::display::{
    DisplayContent, DisplayMessage, DisplayMessageType, DisplayNode, ToolCallResult, ToolCategory,
};

use mainframe_types::acp::content::ContentBlock;
use mainframe_types::acp::extensions::{
    MAINFRAME_META_NAMESPACE, StructuredDiff, TruncationMarker,
};
use mainframe_types::acp::tool_call::{
    Diff, DiffChange, DiffFileType, DiffOperation, DiffPatch, DiffPatchFormat, ToolCallContent,
    ToolCallStatus, ToolKind,
};
use mainframe_types::chat::DiffHunk;
use serde_json::{Value, json};

/// The `_mainframe.dev`-namespaced parent-tool-call relation a flattened
/// subagent item carries in place of `task_group` nesting.
const PARENT_TOOL_CALL_KEY: &str = "parentToolCallId";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ItemRole {
    User,
    Agent,
}

/// One encoded item, addressed by [`EncodedItem::id`]. The diff engine
/// (task 13) compares two `Vec<EncodedItem>` snapshots by id to decide
/// chunk-append vs. full-revision vs. patch.
#[derive(Debug, Clone, PartialEq)]
pub enum EncodedItem {
    Message {
        id: String,
        role: ItemRole,
        text: String,
        meta: Option<Value>,
    },
    Thought {
        id: String,
        text: String,
        meta: Option<Value>,
    },
    ToolCall {
        id: String,
        title: String,
        kind: ToolKind,
        status: ToolCallStatus,
        raw_input: Value,
        content: Vec<ToolCallContent>,
        meta: Option<Value>,
    },
}

impl EncodedItem {
    pub fn id(&self) -> &str {
        match self {
            Self::Message { id, .. } | Self::Thought { id, .. } | Self::ToolCall { id, .. } => id,
        }
    }
}

/// Encode a `DisplayMessage[]` snapshot into the ACP item list.
pub fn encode(messages: &[DisplayMessage]) -> Vec<EncodedItem> {
    let mut out = Vec::new();
    for message in messages {
        let role = role_for(message.r#type);
        encode_content(&message.content, &message.id, role, None, &mut out);
    }
    out
}

fn role_for(t: DisplayMessageType) -> ItemRole {
    match t {
        DisplayMessageType::User => ItemRole::User,
        _ => ItemRole::Agent,
    }
}

fn parent_meta(parent_tool_call_id: Option<&str>) -> Option<Value> {
    parent_tool_call_id.map(|id| json!({ MAINFRAME_META_NAMESPACE: { PARENT_TOOL_CALL_KEY: id } }))
}

/// Encode one content list (a `DisplayMessage`'s top-level content, or a
/// flattened `TaskGroup`'s nested `calls`) under `container_id`. Text/
/// thinking leaves accumulate into one item each, emitted after any
/// interleaved tool calls (module doc: order is not preserved).
fn encode_content(
    content: &[DisplayContent],
    container_id: &str,
    role: ItemRole,
    parent_tool_call_id: Option<&str>,
    out: &mut Vec<EncodedItem>,
) {
    let meta = parent_meta(parent_tool_call_id);
    let mut text = String::new();
    let mut thinking = String::new();

    for block in content {
        match block {
            DisplayContent::Leaf(LeafContent::Text { text: t, .. }) => text.push_str(t),
            DisplayContent::Leaf(LeafContent::Thinking { thinking: t, .. }) => {
                thinking.push_str(t);
            }
            // The vendored ContentBlock is text-only (content.rs module doc);
            // an inline image renders as a placeholder rather than being lost.
            DisplayContent::Leaf(LeafContent::Image { .. }) => text.push_str("[image]"),
            DisplayContent::Leaf(LeafContent::SkillLoaded {
                skill_name, path, ..
            }) => {
                text.push_str(&format!("[skill loaded: {skill_name} ({path})]"));
            }
            DisplayContent::Node(DisplayNode::ToolCall {
                id,
                name,
                input,
                category,
                result,
                ..
            }) => out.push(tool_call_item(
                id,
                name,
                input,
                *category,
                result,
                meta.clone(),
            )),
            DisplayContent::Node(DisplayNode::ToolGroup { calls }) => {
                // Purely a UI grouping (no id, no facade meaning) — flatten in
                // place under the same container/parent.
                encode_content(calls, container_id, role, parent_tool_call_id, out);
            }
            DisplayContent::Node(DisplayNode::TaskGroup {
                agent_id,
                task_args,
                calls,
                result,
            }) => {
                out.push(task_group_item(agent_id, task_args, result, meta.clone()));
                encode_content(calls, agent_id, role, Some(agent_id.as_str()), out);
            }
            DisplayContent::Node(DisplayNode::TaskProgress { items }) => {
                for item in items {
                    out.push(tool_call_item(
                        &item.id,
                        &item.name,
                        &item.input,
                        item.category,
                        &item.result,
                        meta.clone(),
                    ));
                }
            }
            // Gates stay out-of-band on the facade (spec) — no item.
            DisplayContent::Node(DisplayNode::PermissionRequest { .. }) => {}
            DisplayContent::Node(DisplayNode::Error { message }) => {
                text.push_str(&format!("[error] {message}"));
            }
            DisplayContent::Node(DisplayNode::Compaction { .. }) => {
                text.push_str("[context compacted]");
            }
        }
    }

    if !text.is_empty() {
        out.push(EncodedItem::Message {
            id: container_id.to_string(),
            role,
            text,
            meta: meta.clone(),
        });
    }
    if !thinking.is_empty() {
        out.push(EncodedItem::Thought {
            id: format!("{container_id}-thought"),
            text: thinking,
            meta,
        });
    }
}

fn category_to_kind(category: ToolCategory) -> ToolKind {
    match category {
        ToolCategory::Explore => ToolKind::Search,
        ToolCategory::Progress => ToolKind::Execute,
        ToolCategory::Subagent => ToolKind::Think,
        ToolCategory::Hidden | ToolCategory::Default => ToolKind::Other,
    }
}

fn status_for(result: &Option<ToolCallResult>) -> ToolCallStatus {
    match result {
        None => ToolCallStatus::InProgress,
        Some(r) if r.is_error => ToolCallStatus::Failed,
        Some(_) => ToolCallStatus::Completed,
    }
}

fn result_content(
    name: &str,
    input: &HashMap<String, Value>,
    result: &Option<ToolCallResult>,
) -> Vec<ToolCallContent> {
    let Some(r) = result else {
        return Vec::new();
    };
    let mut out = vec![ToolCallContent::Content {
        content: ContentBlock::Text {
            text: r.content.clone(),
            meta: truncation_meta(r),
        },
    }];
    out.extend(diff_content(name, input, r));
    out
}

/// A daemon-truncated result marks its preview text block with the
/// namespaced `truncated`/`fullBytes` pair (spec Decision 20) — the joined
/// text alone cannot say "this is a preview of N bytes", which the legacy
/// dialect's `ToolCallResult` carries inline and the expand affordance needs.
fn truncation_meta(result: &ToolCallResult) -> Option<Value> {
    if result.truncated != Some(true) {
        return None;
    }
    let full_bytes = result.full_bytes?;
    let marker = TruncationMarker {
        truncated: true,
        full_bytes,
    };
    Some(json!({ MAINFRAME_META_NAMESPACE: marker }))
}

/// A result carrying structured hunks becomes a `diff` content entry after
/// the text block: `changes` + `patch` are the ACP-conformant surface a
/// generic client renders, and the hunks/full-file text the desktop Edit/
/// Write cards consume ride the diff's own `_meta["_mainframe.dev"]`
/// (spec Decision 15).
fn diff_content(
    name: &str,
    input: &HashMap<String, Value>,
    result: &ToolCallResult,
) -> Option<ToolCallContent> {
    let hunks = result.structured_patch.as_ref()?;
    let path = input.get("file_path").and_then(Value::as_str)?;
    // A `Write` with no pre-image created the file; anything else that
    // produced hunks modified one in place.
    let is_add = name == "Write" && result.original_file.is_none();
    let operation = if is_add {
        DiffOperation::Add {
            path: path.to_string(),
        }
    } else {
        DiffOperation::Modify {
            path: path.to_string(),
        }
    };
    let fidelity = StructuredDiff {
        structured_patch: hunks.clone(),
        original_file: result.original_file.clone(),
        modified_file: result.modified_file.clone(),
    };
    Some(ToolCallContent::Diff(Diff {
        changes: vec![DiffChange {
            operation,
            file_type: Some(DiffFileType::Text),
            mime_type: None,
            meta: None,
        }],
        patch: Some(DiffPatch {
            format: DiffPatchFormat::GitPatch,
            text: git_patch_text(path, is_add, hunks),
        }),
        meta: Some(json!({ MAINFRAME_META_NAMESPACE: fidelity })),
    }))
}

/// Git `--patch` text per the pinned v2 doc example: bare absolute paths (no
/// `a/`/`b/` prefixes), `/dev/null` as the pre-image of an added file, no
/// commit metadata. `DiffHunk.lines` already carry their `+`/`-`/` ` prefix.
fn git_patch_text(path: &str, is_add: bool, hunks: &[DiffHunk]) -> String {
    let old = if is_add { "/dev/null" } else { path };
    let mut text = format!("diff --git {path} {path}\n--- {old}\n+++ {path}\n");
    for h in hunks {
        text.push_str(&format!(
            "@@ -{},{} +{},{} @@\n",
            h.old_start, h.old_lines, h.new_start, h.new_lines
        ));
        for line in &h.lines {
            text.push_str(line);
            text.push('\n');
        }
    }
    text
}

fn tool_call_item(
    id: &str,
    name: &str,
    input: &HashMap<String, Value>,
    category: ToolCategory,
    result: &Option<ToolCallResult>,
    meta: Option<Value>,
) -> EncodedItem {
    EncodedItem::ToolCall {
        id: id.to_string(),
        title: name.to_string(),
        kind: category_to_kind(category),
        status: status_for(result),
        raw_input: json!(input),
        content: result_content(name, input, result),
        meta,
    }
}

/// `agent_id` doubles as the task group's stable id — it is the unique
/// tool_use id the subagent-launching tool call carried, not a synthesized
/// value (`display_helpers.rs` regression #184 comment: "use the unique
/// tool_use id, not description").
fn task_group_item(
    agent_id: &str,
    task_args: &HashMap<String, Value>,
    result: &Option<ToolCallResult>,
    meta: Option<Value>,
) -> EncodedItem {
    let title = task_args
        .get("description")
        .and_then(Value::as_str)
        .unwrap_or("Subagent task")
        .to_string();
    EncodedItem::ToolCall {
        id: agent_id.to_string(),
        title,
        kind: ToolKind::Think,
        status: status_for(result),
        raw_input: json!(task_args),
        content: result_content("Task", task_args, result),
        meta,
    }
}

#[cfg(test)]
mod tests;
