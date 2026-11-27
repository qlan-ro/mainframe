use crate::chat_manager::{ChatShared, remap_history_for};
use mainframe_adapter_api::{AdapterError, AdapterSession};
use mainframe_types::chat::ChatMessage;

impl ChatShared {
    pub(crate) async fn load_cached_history(
        &self,
        chat_id: &str,
        session: &dyn AdapterSession,
    ) -> Result<Vec<ChatMessage>, AdapterError> {
        let context = self.history_context(chat_id);
        let messages = self
            .history_cache
            .load(chat_id, session, context.as_deref())
            .await
            .map(|messages| remap_history_for(messages, chat_id))?;
        self.merge_idle_history(chat_id, messages)
    }

    /// Reparses `chat_id`'s transcript, persists the snapshot, and returns
    /// the history a cold load would hand to the message cache, without the
    /// queue side effects a real restore has.
    pub(crate) async fn refresh_cached_history(
        &self,
        chat_id: &str,
        session: &dyn AdapterSession,
        background: bool,
    ) -> Option<(Vec<ChatMessage>, crate::HistoryValidation)> {
        let context = self.history_context(chat_id);
        let parsed = self
            .history_cache
            .refresh(chat_id, session, context.as_deref(), background)
            .await?;
        let messages = remap_history_for(parsed.messages, chat_id);
        let messages = self.preview_idle_history(chat_id, messages).ok()?;
        Some((messages, parsed.validation))
    }

    pub(crate) fn history_context(&self, chat_id: &str) -> Option<String> {
        let chat = storage_event!(self, Some(chat_id); self.deps.chats_get(chat_id), None)?;
        let fork = storage_event!(self, Some(chat_id); self.deps.get_pending_fork(chat_id), None);
        serde_json::to_string(&(
            chat.adapter_id,
            chat.vendor_session_id,
            chat.session_file_path,
            fork.map(|pending| pending.fork_source),
        ))
        .ok()
    }
}
