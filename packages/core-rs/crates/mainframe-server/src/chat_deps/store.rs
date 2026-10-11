use super::*;

impl ChatStore for DaemonChatDeps {
    fn store(&self) -> Result<&dyn ChatStore, SeamError> {
        Ok(&self.db)
    }
    fn chats_create(&self, new_chat: &NewChat) -> Result<Chat, SeamError> {
        self.db.chats_create(&NewChat {
            scratch_root: Some(self.data_dir.join("scratch").to_string_lossy().into_owned()),
            ..new_chat.clone()
        })
    }
    fn segment_store(&self) -> Option<&dyn mainframe_chat::segments::SegmentStore> {
        Some(self)
    }
}

impl DaemonChatDeps {
    pub(super) fn emit_storage_error(&self, chat_id: &str, error: SeamError) {
        tracing::error!(%error, chat_id, "chat storage operation failed");
        self.emit_event(DaemonEvent::Error {
            chat_id: Some(chat_id.into()),
            error: error.to_string(),
        });
    }
}
