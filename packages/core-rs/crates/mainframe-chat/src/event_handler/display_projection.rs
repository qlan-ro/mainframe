//! The overlay-aware display projection shared by live `DisplayRevision`s
//! (`event_handler.rs::emit_display_for`) and resume snapshots
//! (`chat_manager/history.rs::get_resume_snapshot`), so both read the exact
//! same "append the in-flight overlay, then determine streaming" behavior
//! from one place (todo #382).
//!
//! Kept deps-trait-free: the caller already knows which `prepare_messages_for_client`
//! it has (`EventHandlerDeps` on the live path, `ChatManagerDeps` on the resume
//! path — two distinct traits with the same shape), so it is passed in as a
//! closure rather than forcing a shared trait bound here.

use mainframe_types::chat::{ChatMessage, MessageContent};
use mainframe_types::content::LeafContent;
use mainframe_types::display::{DisplayContent, DisplayMessage, DisplayMessageType, StreamingLeafKind};

/// Append `overlay` (when present) as a synthetic tail message, run `prepare`
/// over the combined raw history, and determine whether the result is still
/// streaming. Returns `prepare`'s output and `Some(kind)` only when the
/// overlay's own leaf survived conversion onto the prepared display's last
/// message (spec Decision 39).
pub(crate) fn project_display(
    raw: &[ChatMessage],
    overlay: Option<ChatMessage>,
    prepare: impl FnOnce(&[ChatMessage]) -> Vec<DisplayMessage>,
) -> (Vec<DisplayMessage>, Option<StreamingLeafKind>) {
    let has_overlay = overlay.is_some();
    let with_overlay: Vec<ChatMessage>;
    let combined: &[ChatMessage] = match overlay {
        Some(synthetic) => {
            with_overlay = raw
                .iter()
                .cloned()
                .chain(std::iter::once(synthetic))
                .collect();
            &with_overlay[..]
        }
        None => raw,
    };
    let new_display = prepare(combined);
    // The overlay is the last leaf of `combined` when present — read it back
    // off `combined` rather than cloning the overlay a second time.
    let streaming = has_overlay
        .then(|| streaming_leaf_kind(combined.last(), &new_display))
        .flatten();
    (new_display, streaming)
}

/// Spec Decision 39's streaming determination: `Some` only when the overlay's
/// own leaf has non-empty text/thinking after trim AND the prepared display's
/// last message is an assistant message whose own last leaf is the same
/// kind. The second check catches an overlay the conversion stripped to
/// empty (tag stripping, grouping) — that case must never report streaming.
fn streaming_leaf_kind(
    overlay: Option<&ChatMessage>,
    new_display: &[DisplayMessage],
) -> Option<StreamingLeafKind> {
    let overlay_kind = overlay.and_then(overlay_leaf_kind)?;
    let last_message = new_display.last()?;
    if last_message.r#type != DisplayMessageType::Assistant {
        return None;
    }
    let last_leaf_kind = last_message.content.last().and_then(display_leaf_kind)?;
    (overlay_kind == last_leaf_kind).then_some(overlay_kind)
}

fn overlay_leaf_kind(overlay: &ChatMessage) -> Option<StreamingLeafKind> {
    overlay.content.iter().find_map(|c| match c {
        MessageContent::Leaf(LeafContent::Text { text, .. }) if !text.trim().is_empty() => {
            Some(StreamingLeafKind::Text)
        }
        MessageContent::Leaf(LeafContent::Thinking { thinking, .. })
            if !thinking.trim().is_empty() =>
        {
            Some(StreamingLeafKind::Thinking)
        }
        _ => None,
    })
}

fn display_leaf_kind(content: &DisplayContent) -> Option<StreamingLeafKind> {
    match content {
        DisplayContent::Leaf(LeafContent::Text { .. }) => Some(StreamingLeafKind::Text),
        DisplayContent::Leaf(LeafContent::Thinking { .. }) => Some(StreamingLeafKind::Thinking),
        _ => None,
    }
}
