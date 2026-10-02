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
    DisplayContent, DisplayMessage, DisplayMessageType, DisplayNode, StreamingLeafKind,
    ToolCallResult, ToolCategory,
};

use mainframe_types::acp::content::ContentBlock;
use mainframe_types::acp::extensions::{
    ItemContainerKind, ItemMeta, MAINFRAME_META_NAMESPACE, SkillLoadedMeta,
};
use mainframe_types::acp::tool_call::{ToolCallContent, ToolCallStatus, ToolKind};
use serde_json::{Value, json};

mod accum;
mod content;
mod presentation;
mod result_content;
mod tool_call;
use content::encode_content;
use result_content::result_content;
use tool_call::{encode_tool_group, task_group_item, tool_call_item};

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
#[derive(Clone)]
struct Container<'a> {
    presentation_sources: &'a presentation::SourceMap,
    path: Vec<usize>,
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
            message_meta: presentation::legacy_meta(self.message_meta),
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
    encode_messages(messages, None)
}

/// Like `encode`, but for the last non-queued top-level container, marks
/// whichever accumulator segment is still open at `finish` with
/// `ItemMeta.streaming: true` when its kind matches `streaming` (spec
/// Decision 39) — the item the partial-message overlay currently backs.
/// `handle_display_revision` calls this; resume replay keeps `encode`,
/// because a resume snapshot has no overlay.
pub fn encode_revision(
    messages: &[DisplayMessage],
    streaming: Option<StreamingLeafKind>,
) -> Vec<EncodedItem> {
    encode_messages(messages, streaming)
}

fn encode_messages(
    messages: &[DisplayMessage],
    streaming: Option<StreamingLeafKind>,
) -> Vec<EncodedItem> {
    let mut out = Vec::new();
    let last = messages.iter().rposition(|m| !is_queued(m));
    for (index, message) in messages.iter().enumerate() {
        if is_queued(message) {
            continue;
        }
        let sources = presentation::read_sources(message);
        let container = Container {
            presentation_sources: &sources,
            path: Vec::new(),
            id: &message.id,
            timestamp: &message.timestamp,
            kind: kind_for(message.r#type),
            message_meta: message.metadata.as_ref(),
            parent_tool_call_id: None,
        };
        let leaf_kind = if Some(index) == last { streaming } else { None };
        encode_content(
            &message.content,
            &container,
            role_for(message.r#type),
            &mut out,
            leaf_kind,
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

#[cfg(test)]
mod tests;
