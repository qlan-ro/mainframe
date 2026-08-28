//! Per-session diff engine (todo #350, plan task 13): consecutive
//! [`crate::encoder::EncodedItem`] snapshots diff into chunk appends
//! (text/thought suffix growth) and `tool_call_update`-style patches (omit/
//! null/value/append) — never a full resend of an item's accumulated content
//! after its first frame (criterion 3). One [`SessionState`] per attached
//! facade session; `throttle.rs` coalesces its output before it reaches the
//! wire.

use std::collections::HashMap;

use mainframe_types::acp::content::{ContentBlock, ContentChunk};
use mainframe_types::acp::tool_call::ToolCallUpdate;
use mainframe_types::acp::update::{MessageUpsert, SessionUpdate};
use serde_json::Value;

use crate::encoder::{EncodedItem, ItemRole};

/// Per-item last-known state, so a diff against a fresh [`SessionState`]
/// (a just-attached or just-resumed session) always creates every item —
/// matching `session/resume`'s intended "replay from cursor" seam (group E)
/// without this crate depending on that group's cursor scheme.
#[derive(Default)]
pub struct SessionState {
    items: HashMap<String, EncodedItem>,
}

impl SessionState {
    pub fn new() -> Self {
        Self::default()
    }

    /// Diff a fresh encoder snapshot against the last one seen, returning the
    /// `session/update` payloads needed to converge a client from the old
    /// state to the new one. Items no longer present are left as-is (removal
    /// framing is not in this task's scope; encoder inputs only grow).
    pub fn diff(&mut self, new_items: &[EncodedItem]) -> Vec<SessionUpdate> {
        let mut updates = Vec::new();
        for item in new_items {
            match self.items.get(item.id()) {
                None => updates.push(create_update(item)),
                Some(prev) if prev == item => {}
                Some(prev) => updates.extend(revise_update(prev, item)),
            }
            self.items.insert(item.id().to_string(), item.clone());
        }
        updates
    }
}

fn message_variant(role: ItemRole, is_thought: bool) -> fn(ContentChunk) -> SessionUpdate {
    match (role, is_thought) {
        (_, true) => SessionUpdate::AgentThoughtChunk,
        (ItemRole::User, false) => SessionUpdate::UserMessageChunk,
        (ItemRole::Agent, false) => SessionUpdate::AgentMessageChunk,
    }
}

fn upsert_variant(role: ItemRole, is_thought: bool) -> fn(MessageUpsert) -> SessionUpdate {
    match (role, is_thought) {
        (_, true) => SessionUpdate::AgentThought,
        (ItemRole::User, false) => SessionUpdate::UserMessage,
        (ItemRole::Agent, false) => SessionUpdate::AgentMessage,
    }
}

fn text_block(text: &str) -> Vec<ContentBlock> {
    vec![ContentBlock::Text {
        text: text.to_string(),
    }]
}

/// `Option<T> -> Option<Option<T>>`: `Some` creates/replaces, `None` omits
/// (the patch field stays unchanged) — this crate never needs to explicitly
/// *clear* a field, so the `Some(None)` (`null`) arm is unused here.
fn create_patch<T>(value: Option<T>) -> Option<Option<T>> {
    value.map(Some)
}

fn create_update(item: &EncodedItem) -> SessionUpdate {
    match item {
        EncodedItem::Message {
            id,
            role,
            text,
            meta,
        } => upsert_variant(*role, false)(MessageUpsert {
            message_id: id.clone(),
            content: create_patch(Some(text_block(text))),
            meta: create_patch(meta.clone()),
        }),
        EncodedItem::Thought { id, text, meta } => {
            upsert_variant(ItemRole::Agent, true)(MessageUpsert {
                message_id: id.clone(),
                content: create_patch(Some(text_block(text))),
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

/// The invariant this function exists to guarantee (criterion 3): once an
/// item has had its first frame (`create_update`), no later frame for it
/// carries its full accumulated content again — a pure suffix growth is a
/// chunk (the delta only), and anything else is an explicit revision, never
/// a repeat of what the client already has.
fn revise_update(prev: &EncodedItem, new: &EncodedItem) -> Vec<SessionUpdate> {
    match (prev, new) {
        (
            EncodedItem::Message {
                id,
                role,
                text: prev_text,
                meta: prev_meta,
            },
            EncodedItem::Message {
                text: new_text,
                meta: new_meta,
                ..
            },
        ) => text_revision(id, *role, false, prev_text, new_text, prev_meta, new_meta),
        (
            EncodedItem::Thought {
                id,
                text: prev_text,
                meta: prev_meta,
            },
            EncodedItem::Thought {
                text: new_text,
                meta: new_meta,
                ..
            },
        ) => text_revision(
            id,
            ItemRole::Agent,
            true,
            prev_text,
            new_text,
            prev_meta,
            new_meta,
        ),
        (EncodedItem::ToolCall { .. }, EncodedItem::ToolCall { .. }) => {
            vec![tool_call_patch(prev, new)]
        }
        // An item's kind never changes post-creation in this pipeline; a
        // mismatch here would be an encoder bug, not a wire case to model.
        _ => Vec::new(),
    }
}

#[allow(clippy::too_many_arguments)]
fn text_revision(
    id: &str,
    role: ItemRole,
    is_thought: bool,
    prev_text: &str,
    new_text: &str,
    prev_meta: &Option<Value>,
    new_meta: &Option<Value>,
) -> Vec<SessionUpdate> {
    if new_text.len() > prev_text.len() && new_text.starts_with(prev_text) {
        let delta = &new_text[prev_text.len()..];
        return vec![message_variant(role, is_thought)(ContentChunk {
            message_id: id.to_string(),
            content: ContentBlock::Text {
                text: delta.to_string(),
            },
            meta: new_meta.clone().filter(|_| new_meta != prev_meta),
        })];
    }
    // Not a pure append (shrank, or diverged mid-string — e.g. a retry
    // replacing content wholesale, spec decision 10): a full revision, valid
    // exactly once per divergence, never a repeat of a value already sent.
    vec![upsert_variant(role, is_thought)(MessageUpsert {
        message_id: id.to_string(),
        content: create_patch(Some(text_block(new_text))),
        meta: if new_meta == prev_meta {
            None
        } else {
            create_patch(new_meta.clone())
        },
    })]
}

fn tool_call_patch(prev: &EncodedItem, new: &EncodedItem) -> SessionUpdate {
    let (
        EncodedItem::ToolCall {
            id,
            title: pt,
            kind: pk,
            status: ps,
            raw_input: pri,
            content: pc,
            meta: pm,
        },
        EncodedItem::ToolCall {
            title: nt,
            kind: nk,
            status: ns,
            raw_input: nri,
            content: nc,
            meta: nm,
            ..
        },
    ) = (prev, new)
    else {
        unreachable!("tool_call_patch is only called for two ToolCall items");
    };

    SessionUpdate::ToolCallUpdate(ToolCallUpdate {
        tool_call_id: id.clone(),
        title: diff_field(pt, nt),
        kind: diff_field(pk, nk),
        status: diff_field(ps, ns),
        content: diff_field(pc, nc),
        locations: None,
        raw_input: diff_field(pri, nri),
        raw_output: None,
        meta: diff_meta(pm, nm),
    })
}

/// `omit` when unchanged, `value` when it differs — the patch grammar never
/// needs to null a tool-call field here (nothing in the encoder clears one).
fn diff_field<T: Clone + PartialEq>(prev: &T, new: &T) -> Option<Option<T>> {
    if prev == new {
        None
    } else {
        create_patch(Some(new.clone()))
    }
}

/// `meta` is itself `Option<Value>` (absent vs. present, not a patch field on
/// [`EncodedItem`]) — unlike `diff_field`, a change here can legitimately
/// null the wire field (a tool call losing its subagent-parent relation
/// would be `Some(None)`), so this compares one level deeper than
/// `create_patch` alone would.
fn diff_meta(prev: &Option<Value>, new: &Option<Value>) -> Option<Option<Value>> {
    if prev == new { None } else { Some(new.clone()) }
}

#[cfg(test)]
mod tests;
