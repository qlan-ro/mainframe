use super::*;

/// Shared `emitDisplay` used by both `EventHandler::emit_display` and the
/// sink: advance the chat's display projection and hand the resulting delta
/// to the chat-surface seam (the ACP facade's per-connection `SessionStream`
/// owns all diffing). Holds the `MessageCache` guard across `notify` (same
/// as before ): emissions are serialized and the hub handles each
/// synchronously.
pub(super) fn emit_display_for<D: EventHandlerDeps>(
    chat_id: &str,
    messages: &Arc<Mutex<MessageCache>>,
    partial_overlays: &PartialOverlays,
    categories: Option<&ToolCategories>,
    deps: &D,
    surface: Option<&Arc<dyn ChatSurface>>,
) {
    // The in-flight partial content projects as a synthetic tail message: it
    // groups into the current assistant turn (or opens it, under the API
    // message id the completed message will keep), so the surface streams
    // the growing block instead of waiting for its completion.
    let overlay = partial_overlays.message_for(chat_id);
    let mut msgs = messages.lock_recover();
    let delta = msgs.project_display(chat_id, overlay.as_ref(), categories, || {
        deps.display_projector()
    });
    // The streaming rule reads only the current last container (ordinal
    // `len - 1`), via the snapshot's cheap `with_mut` peek — never a full
    // `materialize()` clone of settled history.
    let streaming = overlay.as_ref().and_then(|o| {
        let last = delta.snapshot.with_mut(|list| list.last().cloned());
        streaming_leaf_kind(Some(o), last.as_ref())
    });
    chat_surface::notify(
        surface,
        ChatSurfaceEvent::DisplayRevision {
            chat_id: chat_id.to_string(),
            delta,
            streaming,
        },
    );
}
