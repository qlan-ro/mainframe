//! Single-item `SessionUpdate` construction — creation and clearing — split
//! out of `session_state.rs` (todo #350, plan task 37, R2.13). The
//! comparison logic (`revise_update`, `content_revision`, `chunk_extension`)
//! that decides WHETHER two snapshots differ stays in the parent module;
//! this module only builds the update for a single, already-decided item.

use mainframe_types::acp::content::ContentChunk;
use mainframe_types::acp::tool_call::ToolCallUpdate;
use mainframe_types::acp::update::{MessageUpsert, SessionUpdate};

use crate::encoder::{EncodedItem, ItemRole};

/// The clearing upsert for a vanished item: content replaced with the empty
/// list (patch semantics: `Some` = replace), meta untouched. Should the item
/// later reappear it is a fresh creation — the clear removed it from state.
pub(super) fn clear_update(item: &EncodedItem) -> SessionUpdate {
    let (id, role, is_thought) = match item {
        EncodedItem::Message { id, role, .. } => (id, *role, false),
        EncodedItem::Thought { id, .. } => (id, ItemRole::Agent, true),
        // Filtered out by the caller.
        EncodedItem::ToolCall { id, .. } => (id, ItemRole::Agent, false),
    };
    upsert_variant(role, is_thought)(MessageUpsert {
        message_id: id.clone(),
        content: create_patch(Some(Vec::new())),
        meta: None,
    })
}

pub(super) fn message_variant(
    role: ItemRole,
    is_thought: bool,
) -> fn(ContentChunk) -> SessionUpdate {
    match (role, is_thought) {
        (_, true) => SessionUpdate::AgentThoughtChunk,
        (ItemRole::User, false) => SessionUpdate::UserMessageChunk,
        (ItemRole::Agent, false) => SessionUpdate::AgentMessageChunk,
    }
}

pub(super) fn upsert_variant(
    role: ItemRole,
    is_thought: bool,
) -> fn(MessageUpsert) -> SessionUpdate {
    match (role, is_thought) {
        (_, true) => SessionUpdate::AgentThought,
        (ItemRole::User, false) => SessionUpdate::UserMessage,
        (ItemRole::Agent, false) => SessionUpdate::AgentMessage,
    }
}

/// `Option<T> -> Option<Option<T>>`: `Some` creates/replaces, `None` omits
/// (the patch field stays unchanged). Creation-path helper only — revision
/// meta uses `Some(new_meta.clone())` directly, because a cleared meta must
/// wire as the explicit `Some(None)` (`null`) this mapping cannot produce.
pub(super) fn create_patch<T>(value: Option<T>) -> Option<Option<T>> {
    value.map(Some)
}

pub(super) fn create_update(item: &EncodedItem) -> SessionUpdate {
    match item {
        EncodedItem::Message {
            id,
            role,
            content,
            meta,
        } => upsert_variant(*role, false)(MessageUpsert {
            message_id: id.clone(),
            content: create_patch(Some(content.clone())),
            meta: create_patch(meta.clone()),
        }),
        EncodedItem::Thought { id, content, meta } => {
            upsert_variant(ItemRole::Agent, true)(MessageUpsert {
                message_id: id.clone(),
                content: create_patch(Some(content.clone())),
                meta: create_patch(meta.clone()),
            })
        }
        EncodedItem::ToolCall {
            id,
            title,
            kind,
            status,
            raw_input,
            content,
            meta,
        } => SessionUpdate::ToolCallUpdate(ToolCallUpdate {
            tool_call_id: id.clone(),
            title: create_patch(Some(title.clone())),
            kind: create_patch(Some(*kind)),
            status: create_patch(Some(*status)),
            content: create_patch((!content.is_empty()).then(|| content.clone())),
            locations: None,
            raw_input: create_patch(Some(raw_input.clone())),
            raw_output: None,
            meta: create_patch(meta.clone()),
        }),
    }
}
