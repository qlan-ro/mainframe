use super::*;

impl<D: EventHandlerDeps + 'static> SessionSinkImpl<D> {
    pub(super) fn append_timed_and_display(&self, message: ChatMessage) {
        self.messages
            .lock_recover()
            .append_live(&self.chat_id, self.session_key(), message);
        self.emit_display();
    }

    pub(super) fn finish_tool_timing(&self) {
        let changed = self
            .messages
            .lock_recover()
            .finish_tool_calls(&self.chat_id, self.session_key());
        if changed {
            self.emit_display();
        }
    }

    pub(super) fn append_timed_children(&self, parent: &str, blocks: Vec<MessageContent>) {
        let count = blocks.len();
        let updated = self.messages.lock_recover().append_nested_live(
            &self.chat_id,
            self.session_key(),
            parent,
            blocks,
        );
        if updated {
            self.emit_display();
        } else {
            warn!(
                chat_id = self.chat_id,
                parent_tool_use_id = parent,
                block_count = count,
                "onSubagentChild: parent tool_use not found in cache; dropping blocks"
            );
        }
    }
}
