//! The canonical encoder (todo #350, plan task 12): `DisplayMessage[] → ACP
//! item list`. Pure function — same input always produces the same output —
//! so live streaming and history replay encode identically by construction
//! (plan criterion 10), and the diff engine (`session_state.rs`, task 13)
//! can be tested by feeding it two encoder snapshots directly.
//!
//! Subagent/task content (`DisplayNode::TaskGroup`) flattens to tool-call
//! items carrying a `_meta` parent relation instead of nesting — the facade
//! has no `task_group` (criterion 10). Text/thinking/image leaves under one
//! container id accumulate into an item's ordered block list (spec Decision
//! 22), and that item sits at the position of its FIRST contribution. A run
//! of leaves interrupted by a tool call, a subagent task, or the other leaf
//! kind closes there and resumes as a new *segment* item after it
//! (`accum.rs`), so a turn that alternates prose and tools keeps
//! source order rather than hoisting every paragraph above every tool.
//! Invariant: a block list never holds two adjacent text blocks — text
//! coalesces into the trailing text block — so the diff engine's chunk
//! appends are lossless under the client's trailing-text coalescing rule.
//!
//! Every item carries an `ItemMeta` under `_meta["_mainframe.dev"]`
//! (desktop-cutover pass): timestamp, container id, the raw
//! `DisplayMessage.metadata` map, error/system markers, tool-group
//! membership, and subagent attribution — the display fidelity the core ACP
//! grammar has no fields for. Hidden-category tool calls are not encoded at
//! all: the legacy renderer never shows them, and an item without its
//! category could not be hidden client-side.

use std::collections::HashMap;

use mainframe_types::content::LeafContent;
use mainframe_types::display::{
    DisplayContent, DisplayMessage, DisplayMessageType, DisplayNode, ToolCallResult, ToolCategory,
};

use mainframe_types::acp::content::ContentBlock;
use mainframe_types::acp::extensions::{
    ItemContainerKind, ItemMeta, MAINFRAME_META_NAMESPACE, SkillLoadedMeta,
};
use mainframe_types::acp::tool_call::{ToolCallContent, ToolCallStatus, ToolKind};
use serde_json::{Value, json};

mod accum;
mod content;
mod result_content;
use content::encode_content;
use result_content::result_content;

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
        content: Vec<ContentBlock>,
        meta: Option<Value>,
    },
    Thought {
        id: String,
        content: Vec<ContentBlock>,
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

/// The per-container context every item inherits: the reaggregation key,
/// the display timestamp, the raw metadata map, and the parent relation.
struct Container<'a> {
    id: &'a str,
    timestamp: &'a str,
    kind: Option<ItemContainerKind>,
    message_meta: Option<&'a HashMap<String, Value>>,
    parent_tool_call_id: Option<&'a str>,
}

impl Container<'_> {
    /// The container's message-item id. Top-level containers use the
    /// `DisplayMessage` id itself (Decision 23: the item id IS the message
    /// id); a task-group child suffixes it — its container id is the parent
    /// Task tool call's id, and an unsuffixed message item would collide
    /// with (and clobber) that tool-call item in any id-keyed accumulator.
    fn message_item_id(&self) -> String {
        match self.parent_tool_call_id {
            Some(_) => format!("{}-message", self.id),
            None => self.id.to_string(),
        }
    }

    fn base_meta(&self) -> ItemMeta {
        ItemMeta {
            timestamp: Some(self.timestamp.to_string()),
            container_id: Some(self.id.to_string()),
            parent_tool_call_id: self.parent_tool_call_id.map(str::to_string),
            kind: self.kind,
            message_meta: self.message_meta.cloned(),
            ..ItemMeta::default()
        }
    }
}

fn wrap_meta(meta: ItemMeta) -> Option<Value> {
    serde_json::to_value(meta)
        .ok()
        .map(|value| json!({ MAINFRAME_META_NAMESPACE: value }))
}

/// Queued turns render from the `queue_state` snapshot, not the transcript
/// (D1) — the encoder drops them so a dequeue is a plain create at the tail
/// instead of a reorder the wire cannot express.
fn is_queued(message: &DisplayMessage) -> bool {
    message
        .metadata
        .as_ref()
        .and_then(|meta| meta.get("queued"))
        .and_then(Value::as_bool)
        .unwrap_or(false)
}

/// Encode a `DisplayMessage[]` snapshot into the ACP item list.
pub fn encode(messages: &[DisplayMessage]) -> Vec<EncodedItem> {
    let mut out = Vec::new();
    for message in messages {
        if is_queued(message) {
            continue;
        }
        let container = Container {
            id: &message.id,
            timestamp: &message.timestamp,
            kind: kind_for(message.r#type),
            message_meta: message.metadata.as_ref(),
            parent_tool_call_id: None,
        };
        encode_content(
            &message.content,
            &container,
            role_for(message.r#type),
            &mut out,
        );
    }
    out
}

fn role_for(t: DisplayMessageType) -> ItemRole {
    match t {
        DisplayMessageType::User => ItemRole::User,
        _ => ItemRole::Agent,
    }
}

fn kind_for(t: DisplayMessageType) -> Option<ItemContainerKind> {
    match t {
        DisplayMessageType::System => Some(ItemContainerKind::System),
        DisplayMessageType::Error => Some(ItemContainerKind::Error),
        _ => None,
    }
}

/// Flatten a `tool_group` in place, stamping the daemon's membership on each
/// visible member: the first visible member's id doubles as the group id —
/// the same scheme the legacy projection used (`map-assistant-blocks.ts`).
fn encode_tool_group(
    calls: &[DisplayContent],
    container: &Container<'_>,
    out: &mut Vec<EncodedItem>,
) {
    let group_id = calls.iter().find_map(|call| match call {
        DisplayContent::Node(DisplayNode::ToolCall { id, category, .. })
            if *category != ToolCategory::Hidden =>
        {
            Some(id.clone())
        }
        _ => None,
    });
    for call in calls {
        if let DisplayContent::Node(DisplayNode::ToolCall {
            id,
            name,
            input,
            category,
            result,
            ..
        }) = call
            && *category != ToolCategory::Hidden
        {
            out.push(tool_call_item(
                id,
                name,
                input,
                *category,
                result,
                container,
                group_id.as_deref(),
            ));
        }
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

#[allow(clippy::too_many_arguments)]
fn tool_call_item(
    id: &str,
    name: &str,
    input: &HashMap<String, Value>,
    category: ToolCategory,
    result: &Option<ToolCallResult>,
    container: &Container<'_>,
    group_id: Option<&str>,
) -> EncodedItem {
    EncodedItem::ToolCall {
        id: id.to_string(),
        title: name.to_string(),
        kind: category_to_kind(category),
        status: status_for(result),
        raw_input: json!(input),
        content: result_content(name, input, result),
        meta: wrap_meta(ItemMeta {
            group_id: group_id.map(str::to_string),
            ..container.base_meta()
        }),
    }
}

/// `agent_id` doubles as the task group's stable id — it is the unique
/// tool_use id the subagent-launching tool call carried, not a synthesized
/// value (`display_helpers.rs` regression #184 comment: "use the unique
/// tool_use id, not description"). `subagent: true` marks that `title` is
/// the task description, not a tool name.
fn task_group_item(
    agent_id: &str,
    task_args: &HashMap<String, Value>,
    result: &Option<ToolCallResult>,
    container: &Container<'_>,
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
        meta: wrap_meta(ItemMeta {
            subagent: Some(true),
            ..container.base_meta()
        }),
    }
}

#[cfg(test)]
mod tests;
