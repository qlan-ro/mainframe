//! An unsent fork that switches provider. Its pinned native row never ran,
//! and the target can't resume another provider's pin, so the row becomes a
//! read-only view of the parent's source session, bounded where the fork's
//! pre-send history ends. The pending fork is retired in the same commit, and
//! the target starts fresh with a `full` handoff.

use mainframe_types::chat::{Chat, ChatMessage};
use mainframe_types::segment::{BorrowConversion, SegmentBound, SegmentLayout};

use super::divider::is_divider;
use crate::fork::PendingForkState;

pub struct BorrowInput<'a> {
    pub chat: &'a Chat,
    pub layout: &'a SegmentLayout,
    pub pending: &'a PendingForkState,
    /// The parent's layout, to find the source session's transcript path.
    pub parent_layout: Option<&'a SegmentLayout>,
    /// The fork's history as it shows before its first send (the pin).
    pub messages: &'a [ChatMessage],
}

/// `None` when the fork has no parent or no active segment.
pub(crate) fn borrow_conversion(i: &BorrowInput<'_>) -> Option<BorrowConversion> {
    let owner = i.chat.parent_chat_id.clone().flatten()?;
    let native_ref = i.layout.active()?.native_session_ref.clone();
    let source_id = i.pending.fork_source.source_session_id.clone();
    let session_file_path = i
        .parent_layout
        .and_then(|l| {
            l.natives
                .iter()
                .find(|n| n.native_session_id.as_deref() == Some(source_id.as_str()))
        })
        .and_then(|n| n.session_file_path.clone());
    Some(BorrowConversion {
        chat_id: i.chat.id.clone(),
        bounds: pinned_bounds(i.layout, &native_ref, i.messages, &i.chat.created_at),
        native_ref,
        owner_chat_id: owner,
        native_session_id: source_id,
        session_file_path,
    })
}

/// Each segment on `native_ref` ends at its last message in `messages`
/// (split at dividers). A segment that shows nothing is bounded by
/// `fallback_at` (the fork's creation), so it never widens to the parent's
/// whole transcript.
pub fn pinned_bounds(
    layout: &SegmentLayout,
    native_ref: &str,
    messages: &[ChatMessage],
    fallback_at: &str,
) -> Vec<SegmentBound> {
    let mut last: Vec<(String, Option<&ChatMessage>)> = layout
        .segments
        .iter()
        .map(|s| (s.id.clone(), None))
        .collect();
    let mut current = 0;
    for message in messages {
        if is_divider(message) {
            let opened = message.id.trim_start_matches("segdiv-");
            current = last
                .iter()
                .position(|(id, _)| id == opened)
                .unwrap_or(current);
        } else if let Some(slot) = last.get_mut(current) {
            slot.1 = Some(message);
        }
    }
    layout
        .segments
        .iter()
        .zip(last)
        .filter(|(segment, _)| segment.native_session_ref == native_ref)
        .map(|(segment, (_, end))| SegmentBound {
            segment_id: segment.id.clone(),
            end_message_id: end.map(|m| m.id.clone()),
            end_at: end
                .map(|m| m.timestamp.clone())
                .filter(|at| !at.is_empty())
                .or_else(|| Some(fallback_at.to_string())),
        })
        .collect()
}

/// The layout as the commit will leave it, so switch planning sees a
/// borrowed row (never resumed) instead of an id-less pending one.
pub fn apply_to_layout(layout: &mut SegmentLayout, c: &BorrowConversion) {
    if let Some(native) = layout.natives.iter_mut().find(|n| n.id == c.native_ref) {
        native.borrowed_from_chat_id = Some(c.owner_chat_id.clone());
        native.native_session_id = Some(c.native_session_id.clone());
        native.session_file_path = c.session_file_path.clone();
    }
    for bound in &c.bounds {
        if let Some(segment) = layout
            .segments
            .iter_mut()
            .find(|s| s.id == bound.segment_id)
        {
            segment.end_bound_message_id = bound.end_message_id.clone();
            segment.end_bound_at = bound.end_at.clone();
        }
    }
}
