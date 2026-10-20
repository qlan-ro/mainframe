use super::display_projection::streaming_leaf_kind;
use super::*;

impl EventHandler {
    pub fn display_snapshot(
        &self,
        chat_id: &str,
        raw: &[ChatMessage],
    ) -> (Vec<DisplayMessage>, Option<StreamingLeafKind>) {
        self.read_display_snapshot(chat_id, raw, |messages, streaming| {
            (messages.to_vec(), streaming)
        })
    }

    // A cold load can evict itself before this read acquires the cache lock.
    pub fn read_display_snapshot<R>(
        &self,
        chat_id: &str,
        raw: &[ChatMessage],
        read: impl FnOnce(&[DisplayMessage], Option<StreamingLeafKind>) -> R,
    ) -> R {
        let categories = self.shared.deps.get_tool_categories(chat_id);
        let overlay = self.partial_overlays.message_for(chat_id);
        self.messages.lock_recover().read_display_snapshot(
            chat_id,
            raw,
            overlay.as_ref(),
            categories.as_ref(),
            || self.shared.deps.display_projector(chat_id),
            |messages| read_streaming(messages, overlay.as_ref(), read),
        )
    }

    pub(crate) fn try_read_cached_resume<R, F>(&self, chat_id: &str, read: F) -> Result<R, F>
    where
        F: FnOnce(&[DisplayMessage], Option<StreamingLeafKind>, Option<ControlRequest>) -> R,
    {
        let pending = self
            .permissions
            .lock_recover()
            .get_pending(chat_id)
            .cloned();
        let categories = self.shared.deps.get_tool_categories(chat_id);
        let mut cache = self.messages.lock_recover();
        if cache.get(chat_id).is_none_or(Vec::is_empty) {
            return Err(read);
        }
        // Finalization removes the overlay before appending.
        let overlay = self.partial_overlays.message_for(chat_id);
        Ok(cache.read_cached_display_snapshot(
            chat_id,
            overlay.as_ref(),
            categories.as_ref(),
            || self.shared.deps.display_projector(chat_id),
            |messages| {
                read_streaming(messages, overlay.as_ref(), |messages, streaming| {
                    read(messages, streaming, pending)
                })
            },
        ))
    }
}

fn read_streaming<R>(
    messages: &[DisplayMessage],
    overlay: Option<&ChatMessage>,
    read: impl FnOnce(&[DisplayMessage], Option<StreamingLeafKind>) -> R,
) -> R {
    let streaming = overlay.and_then(|overlay| streaming_leaf_kind(Some(overlay), messages.last()));
    read(messages, streaming)
}
