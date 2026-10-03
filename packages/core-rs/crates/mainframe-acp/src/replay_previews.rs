//! Replay result previews (spec Decision 41): on a full `session/resume`
//! replay, tool results that belong to containers older than the newest
//! [`FULL_RESULT_CONTAINERS`] are sent as a short preview carrying the
//! existing truncation marker, so the client's expand affordance fetches
//! the full text on demand (`GET /api/chats/{id}/tool-result/{toolUseId}`).
//!
//! Measured on real transcripts, tool-result text is 85–95% of a long
//! chat's replay bytes (one 1958-item chat replayed 31.6 MB, 28.9 MB of it
//! results), and the user is reading the tail. Everything else — raw input,
//! diffs, images, message text — is left untouched.
//!
//! The preview set is a property of the CONNECTION's seeded state, not of
//! the item: `SessionState` keeps it and re-applies the same trim to every
//! later revision of those ids, so a live full re-encode of an old
//! container compares equal to the seeded preview and emits nothing. New
//! items never join the set. A client that did not opt in gets no previews
//! at all (an empty set).

use std::collections::HashSet;

use mainframe_types::acp::content::ContentBlock;
use mainframe_types::acp::extensions::{MAINFRAME_META_NAMESPACE, TruncationMarker};
use mainframe_types::acp::tool_call::ToolCallContent;
use serde_json::{Map, Value, json};

use crate::encoder::EncodedItem;

/// The newest containers whose tool results replay in full.
pub const FULL_RESULT_CONTAINERS: usize = 20;
/// Bytes of result text a previewed tool call keeps.
pub const PREVIEW_BYTES: usize = 2048;

/// The ids of every tool call in `containers` older than the newest
/// [`FULL_RESULT_CONTAINERS`] whose result text [`preview_item`] would
/// actually shorten.
pub fn preview_ids(containers: &[Vec<EncodedItem>]) -> HashSet<String> {
    let old = containers.len().saturating_sub(FULL_RESULT_CONTAINERS);
    containers[..old]
        .iter()
        .flatten()
        .filter(|item| needs_preview(item))
        .map(|item| item.id().to_string())
        .collect()
}

fn needs_preview(item: &EncodedItem) -> bool {
    let EncodedItem::ToolCall { content, .. } = item else {
        return false;
    };
    content.iter().any(|entry| match entry {
        ToolCallContent::Content {
            content: ContentBlock::Text { text, .. },
        } => text.len() > PREVIEW_BYTES,
        _ => false,
    })
}

/// `item` with every text result block cut to [`PREVIEW_BYTES`] and marked
/// truncated. A block the display layer already truncated keeps its original
/// `fullBytes`; a block that fits is returned as-is. Non-tool items and
/// non-text content (images, diffs) are untouched.
pub fn preview_item(item: &EncodedItem) -> EncodedItem {
    let EncodedItem::ToolCall {
        id,
        title,
        kind,
        status,
        raw_input,
        content,
        meta,
    } = item
    else {
        return item.clone();
    };
    EncodedItem::ToolCall {
        id: id.clone(),
        title: title.clone(),
        kind: *kind,
        status: *status,
        raw_input: raw_input.clone(),
        content: content.iter().map(preview_content).collect(),
        meta: meta.clone(),
    }
}

fn preview_content(entry: &ToolCallContent) -> ToolCallContent {
    match entry {
        ToolCallContent::Content {
            content: ContentBlock::Text { text, meta },
        } if text.len() > PREVIEW_BYTES => ToolCallContent::Content {
            content: ContentBlock::Text {
                text: text[..char_boundary_at(text, PREVIEW_BYTES)].to_string(),
                meta: Some(with_truncation_marker(meta.as_ref(), text.len())),
            },
        },
        other => other.clone(),
    }
}

/// The largest char boundary at or below `at`.
fn char_boundary_at(text: &str, at: usize) -> usize {
    let mut index = at.min(text.len());
    while !text.is_char_boundary(index) {
        index -= 1;
    }
    index
}

/// The block meta with `{truncated: true, fullBytes}` merged into the
/// `_mainframe.dev` namespace. An existing marker's `fullBytes` (the display
/// layer's own truncation) wins over the preview's input length, which is
/// already shorter than the real result.
fn with_truncation_marker(meta: Option<&Value>, text_bytes: usize) -> Value {
    let mut root = match meta {
        Some(Value::Object(fields)) => fields.clone(),
        _ => Map::new(),
    };
    let mut ns = match root.remove(MAINFRAME_META_NAMESPACE) {
        Some(Value::Object(fields)) => fields,
        _ => Map::new(),
    };
    let full_bytes = ns
        .get("fullBytes")
        .and_then(Value::as_i64)
        .filter(|_| ns.get("truncated") == Some(&Value::Bool(true)))
        .unwrap_or(text_bytes as i64);
    let marker = TruncationMarker {
        truncated: true,
        full_bytes,
    };
    if let Ok(Value::Object(fields)) = serde_json::to_value(marker) {
        ns.extend(fields);
    }
    root.insert(MAINFRAME_META_NAMESPACE.to_string(), Value::Object(ns));
    json!(root)
}

#[cfg(test)]
mod tests;
