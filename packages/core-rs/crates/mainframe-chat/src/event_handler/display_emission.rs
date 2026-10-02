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
    let overlay = partial_overlays.message_for(chat_id);
    let (new_display, streaming) = project_display(raw, overlay, |combined| {
        deps.prepare_messages_for_client(combined, categories)
    });
    chat_surface::notify(
        surface,
        ChatSurfaceEvent::DisplayRevision {
            chat_id: chat_id.to_string(),
            messages: new_display,
            streaming,
        },
    );
}
