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
        self.history_cache
            .load(chat_id, session, context.as_deref())
            .await
            .map(|messages| remap_history_for(messages, chat_id))
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
