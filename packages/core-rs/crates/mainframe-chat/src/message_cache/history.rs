use super::*;

impl MessageCache {
    pub fn set(&mut self, chat_id: &str, messages: Vec<ChatMessage>) {
        let messages = self.merge_history(chat_id, messages);
        self.replace_messages(chat_id, messages);
    }

    pub(crate) fn set_and_snapshot(
        &mut self,
        chat_id: &str,
        messages: Vec<ChatMessage>,
    ) -> Vec<ChatMessage> {
        let messages = self.merge_history(chat_id, messages);
        self.replace_messages(chat_id, messages.clone());
        messages
    }

    fn merge_history(&mut self, chat_id: &str, mut messages: Vec<ChatMessage>) -> Vec<ChatMessage> {
        self.tool_timings
            .entry(chat_id.to_owned())
            .or_default()
            .merge_history(&mut messages);
        messages
    }

    fn replace_messages(&mut self, chat_id: &str, messages: Vec<ChatMessage>) {
        self.track_key(chat_id);
        self.cache.insert(chat_id.to_owned(), messages);
        self.drop_projection(chat_id);
        self.evict_if_needed();
    }
}
