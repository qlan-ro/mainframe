use super::*;
use mainframe_types::sync::LockExt as _;

impl ChatManager {
    fn update_queued_ref_text(&self, uuid: &str, content: &str) {
        for r in self
            .shared
            .queued_refs
            .lock_recover()
            .iter_mut()
            .filter(|r| r.uuid == uuid)
        {
            r.content = content.to_owned();
        }
    }

    pub(super) async fn edit_maintenance_input(
        &self,
        chat_id: &str,
        message_id: &str,
        content: Option<&str>,
    ) -> Result<bool, SendError> {
        let _lock = self
            .handoff_locks
            .acquire(&format!("maintenance:{chat_id}"))
            .await;
        let Some(mut input) = self
            .shared
            .deps
            .idle_queue_list(chat_id)?
            .into_iter()
            .find(|input| input.message.id == message_id)
        else {
            return Ok(false);
        };
        if let Some(content) = content {
            edit_input(&mut input, content);
            self.shared.deps.idle_queue_put(chat_id, &input)?;
            self.shared
                .messages
                .lock_recover()
                .update_in_place(chat_id, |message| {
                    if message.id != message_id {
                        return false;
                    }
                    *message = input.message.clone();
                    true
                });
            self.update_queued_ref_text(&input.uuid, content);
        } else if self.shared.deps.idle_queue_remove(chat_id, &input.uuid)? {
            self.shared
                .messages
                .lock_recover()
                .remove_by_id(chat_id, message_id);
            self.shared
                .queued_refs
                .lock_recover()
                .retain(|r| r.uuid != input.uuid);
        }
        self.notify_queue_changed(chat_id);
        self.event_handler.emit_display(chat_id);
        Ok(true)
    }
}

fn edit_input(input: &mut mainframe_db::idle_compaction_queue::QueuedInput, content: &str) {
    if !input.content.is_empty()
        && input.message.content.last().is_some_and(|c| {
            matches!(c,
        MessageContent::Leaf(LeafContent::Text { text, .. }) if text == &input.content)
        })
    {
        input.message.content.pop();
    }
    if !content.is_empty() {
        input
            .message
            .content
            .push(MessageContent::Leaf(LeafContent::Text {
                text: content.to_owned(),
                parent_tool_use_id: None,
            }));
    }
    input.prepared_text = match (input.text_prefix.is_empty(), content.is_empty()) {
        (true, _) => content.to_owned(),
        (false, true) => input.text_prefix.clone(),
        (false, false) => format!("{}\n\n{content}", input.text_prefix),
    };
    input.content = content.to_owned();
}
