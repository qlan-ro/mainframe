//! The streaming determination shared by live `DisplayRevision`s
//! (`event_handler.rs::emit_display_for`) and resume snapshots
//! (`EventHandler::display_snapshot`), so both read the exact same rule
//! (todo #382). Before todo #376 this module also combined the overlay with
//! raw history and ran `prepare` over the result; that step now lives inside
//! each `DisplayProjector` (`mainframe-display`, `mainframe-adapter-claude`),
//! so only the streaming rule remains here.

use mainframe_types::chat::{ChatMessage, MessageContent};
use mainframe_types::content::LeafContent;
use mainframe_types::display::{
    DisplayContent, DisplayMessage, DisplayMessageType, StreamingLeafKind,
};

/// Spec Decision 39's streaming determination: `Some` only when the overlay's
/// own leaf has non-empty text/thinking after trim AND the prepared display's
/// last container is an assistant message whose own last leaf is the same
/// kind. The second check catches an overlay the conversion stripped to
/// empty (tag stripping, grouping) — that case must never report streaming.
/// `last_container` is the projection's current last container (ordinal
/// `len - 1`), read from the projector's snapshot rather than a full
/// materialized list — the streaming check never needs to look further back.
pub(crate) fn streaming_leaf_kind(
    overlay: Option<&ChatMessage>,
    last_container: Option<&DisplayMessage>,
) -> Option<StreamingLeafKind> {
    let overlay_kind = overlay.and_then(overlay_leaf_kind)?;
    let last_message = last_container?;
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
