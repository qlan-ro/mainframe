use super::*;

/// Shared `emitDisplay` used by both `EventHandler::emit_display` and the
/// sink: recompute the chat's display snapshot and hand it to the chat-surface
/// seam (the ACP facade's per-connection `SessionStream` owns all diffing).
pub(super) fn emit_display_for<D: EventHandlerDeps>(
    chat_id: &str,
    messages: &Arc<Mutex<MessageCache>>,
    partial_overlays: &PartialOverlays,
    categories: Option<&ToolCategories>,
    deps: &D,
    surface: Option<&Arc<dyn ChatSurface>>,
) {
    let msgs = messages.lock().unwrap_or_else(|e| e.into_inner());
    let raw: &[ChatMessage] = msgs.get(chat_id).map(Vec::as_slice).unwrap_or(&[]);
    // Append the in-flight partial content as a synthetic tail message: it
    // groups into the current assistant turn (or opens it, under the API
    // message id the completed message will keep), so the surface streams
    // the growing block instead of waiting for its completion.
    let overlay = partial_overlays.message_for(chat_id);
    let has_overlay = overlay.is_some();
    let with_overlay: Vec<ChatMessage>;
    let raw = match overlay {
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
    let new_display = deps.prepare_messages_for_client(raw, categories);
    // The overlay is the last leaf of `raw` when present — read it back off
    // `raw` rather than cloning the overlay a second time.
    let streaming = has_overlay
        .then(|| streaming_leaf_kind(raw.last(), &new_display))
        .flatten();
    chat_surface::notify(
        surface,
        ChatSurfaceEvent::DisplayRevision {
            chat_id: chat_id.to_string(),
            messages: new_display,
            streaming,
        },
    );
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
