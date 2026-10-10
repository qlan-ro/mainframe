//! Splits one native session's transcript back into the segments it backs.
//!
//! A user message that opens with a handoff marker naming one of this native
//! session's segments starts that segment; everything before the first found
//! marker belongs to the earliest. A missing marker (a handoff never
//! delivered) leaves that segment empty, its messages staying with the
//! previous one. Markers naming segments on other sessions (a pasted marker)
//! split nothing.

use std::collections::HashMap;

use mainframe_types::chat::{ChatMessage, ChatMessageType, MessageContent};
use mainframe_types::content::LeafContent;
use mainframe_types::segment::SegmentRecord;

use crate::handoff::{leading_marker_segment, strip_marker};

/// The first text leaf of a user message, where the handoff block sits.
fn first_text_mut(message: &mut ChatMessage) -> Option<&mut String> {
    if message.r#type != ChatMessageType::User {
        return None;
    }
    message.content.iter_mut().find_map(|block| match block {
        MessageContent::Leaf(LeafContent::Text { text, .. }) => Some(text),
        _ => None,
    })
}

/// The segment id a message's marker opens, among `segments`.
fn opened_segment<'a>(message: &ChatMessage, segments: &'a [&SegmentRecord]) -> Option<&'a str> {
    let text = message.content.iter().find_map(|block| match block {
        MessageContent::Leaf(LeafContent::Text { text, .. }) => Some(text.as_str()),
        _ => None,
    })?;
    if message.r#type != ChatMessageType::User {
        return None;
    }
    let marker = leading_marker_segment(text)?;
    segments
        .iter()
        .find(|s| s.start_marker.as_deref() == Some(marker))
        .map(|s| s.id.as_str())
}

/// Removes a leading handoff block from a user message (live messages never
/// carry one; this makes the cold copy byte-identical).
pub(crate) fn strip_message_marker(message: &mut ChatMessage) {
    if let Some(text) = first_text_mut(message) {
        let stripped = strip_marker(text);
        if stripped.len() != text.len() {
            *text = stripped.to_string();
        }
    }
}

/// `segments` are the segments backed by this native session, in any order.
pub fn partition(
    messages: Vec<ChatMessage>,
    segments: &[&SegmentRecord],
) -> HashMap<String, Vec<ChatMessage>> {
    let mut ordered: Vec<&SegmentRecord> = segments.to_vec();
    ordered.sort_by_key(|s| s.ordinal);
    let mut out: HashMap<String, Vec<ChatMessage>> = HashMap::new();
    let Some(first) = ordered.first() else {
        return out;
    };
    let mut current = first.id.clone();
    for mut message in messages {
        if let Some(opened) = opened_segment(&message, &ordered) {
            current = opened.to_string();
            strip_message_marker(&mut message);
        }
        out.entry(current.clone()).or_default().push(message);
    }
    out
}

/// A borrowed segment ends where its owner's segment ended: at
/// `end_bound_message_id` when that message is present, else at
/// `end_bound_at` (inclusive), else unbounded.
pub fn bound(
    mut messages: Vec<ChatMessage>,
    end_message_id: Option<&str>,
    end_at: Option<&str>,
) -> Vec<ChatMessage> {
    if let Some(id) = end_message_id
        && let Some(index) = messages.iter().position(|m| m.id == id)
    {
        messages.truncate(index + 1);
        return messages;
    }
    if let Some(at) = end_at {
        messages.retain(|m| m.timestamp.as_str() <= at);
    }
    messages
}
