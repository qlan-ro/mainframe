use crate::chat_manager::ChatShared;
use mainframe_types::sync::LockExt as _;
use mainframe_types::{
    chat::{ChatMessage, MessageContent, MessageContentNode},
    compaction::{CompactionMetadata, NativeCompactionRequest},
};

impl ChatShared {
    pub(crate) fn merge_idle_history(
        &self,
        chat_id: &str,
        history: Vec<ChatMessage>,
    ) -> Result<Vec<ChatMessage>, mainframe_adapter_api::AdapterError> {
        let mut history = self.merge_idle_provenance(chat_id, history)?;
        self.restore_queue_pause(chat_id)?;
        self.reconcile_idle_queue(chat_id, &mut history)?;
        Ok(history)
    }

    /// The idle-compaction records and markers folded into `history`, with no
    /// effect on the queue: the part of the merge a read-only view can share.
    pub(crate) fn merge_idle_provenance(
        &self,
        chat_id: &str,
        history: Vec<ChatMessage>,
    ) -> Result<Vec<ChatMessage>, mainframe_adapter_api::AdapterError> {
        self.merge_idle_provenance_in(chat_id, history, false)
    }

    /// As [`Self::merge_idle_provenance`] for the newest part of a history
    /// (`older`: turns before it exist). A marker the full list would settle
    /// before the page is left out: one whose transcript boundary lies before
    /// the page (the full merge renames that boundary to the marker's id, so
    /// no marker is inserted), and one stamped before the page's first message.
    pub(crate) fn merge_idle_window(
        &self,
        chat_id: &str,
        history: Vec<ChatMessage>,
        older: bool,
    ) -> Result<Vec<ChatMessage>, mainframe_adapter_api::AdapterError> {
        self.merge_idle_provenance_in(chat_id, history, older)
    }

    fn merge_idle_provenance_in(
        &self,
        chat_id: &str,
        mut history: Vec<ChatMessage>,
        older: bool,
    ) -> Result<Vec<ChatMessage>, mainframe_adapter_api::AdapterError> {
        let commands = self.deps.idle_commands(chat_id).map_err(|_| {
            mainframe_adapter_api::AdapterError::Message(
                "Idle history provenance unavailable".into(),
            )
        })?;
        let metadata = self.deps.idle_provenance(chat_id).map_err(|_| {
            mainframe_adapter_api::AdapterError::Message(
                "Idle history provenance unavailable".into(),
            )
        })?;
        merge(&mut history, &commands, &metadata);
        let first = history.first().map(|m| m.timestamp.clone());
        for marker in self.deps.idle_markers(chat_id).map_err(|_| {
            mainframe_adapter_api::AdapterError::Message("Idle markers unavailable".into())
        })? {
            if history.iter().any(|m| m.id == marker.id) {
                continue;
            }
            let before_page = older
                && (first
                    .as_ref()
                    .is_some_and(|first| marker.timestamp < *first)
                    || metadata
                        .iter()
                        .any(|m| m.request_id == marker.id && m.vendor_id.is_some()));
            if before_page {
                continue;
            }
            let index = history
                .iter()
                .position(|m| m.timestamp > marker.timestamp)
                .unwrap_or(history.len());
            history.insert(index, marker);
        }
        Ok(history)
    }

    /// What `merge_idle_history` would show after a restart, without touching
    /// the live queue: held prompts the transcript does not yet contain are
    /// appended, and nothing is acknowledged, paused or re-queued.
    pub(crate) fn preview_idle_history(
        &self,
        chat_id: &str,
        history: Vec<ChatMessage>,
    ) -> Result<Vec<ChatMessage>, mainframe_adapter_api::AdapterError> {
        let mut history = self.merge_idle_provenance(chat_id, history)?;
        for input in self.deps.idle_queue_list(chat_id).map_err(|_| {
            mainframe_adapter_api::AdapterError::Message("Queued history unavailable".into())
        })? {
            if !history
                .iter()
                .any(|m| m.id == input.message.id || input.matches_provider_message(m))
            {
                history.push(input.message);
            }
        }
        Ok(history)
    }

    fn reconcile_idle_queue(
        &self,
        chat_id: &str,
        history: &mut Vec<ChatMessage>,
    ) -> Result<(), mainframe_adapter_api::AdapterError> {
        let mut restored_head = self.queued_for_chat(chat_id).is_empty();
        for input in self.deps.idle_queue_list(chat_id).map_err(|_| {
            mainframe_adapter_api::AdapterError::Message("Queued history unavailable".into())
        })? {
            if history
                .iter()
                .any(|m| m.id == input.message.id || input.matches_provider_message(m))
            {
                self.deps
                    .idle_queue_remove(chat_id, &input.uuid)
                    .map_err(|_| {
                        mainframe_adapter_api::AdapterError::Message(
                            "Queue acknowledgement persistence failed".into(),
                        )
                    })?;
                self.handle_queued_processed(chat_id, &input.uuid);
                continue;
            }
            if restored_head
                && input.delivery == mainframe_db::idle_compaction_queue::DeliveryState::Pending
            {
                self.pause_maintenance_queue(chat_id, "Session ended");
            }
            restored_head = false;
            let mut refs = self.queued_refs.lock_recover();
            if !refs.iter().any(|r| r.uuid == input.uuid) {
                refs.push(input.queued_ref(chat_id));
            }
            history.push(input.message);
        }
        Ok(())
    }
}

pub(crate) fn merge(
    history: &mut Vec<ChatMessage>,
    commands: &[NativeCompactionRequest],
    metadata: &[CompactionMetadata],
) {
    history.retain(|message| {
        !commands
            .iter()
            .any(|request| internal_id(&message.id, &request.command_uuid))
    });
    for data in metadata {
        let existing = history
            .iter_mut()
            .find(|m| m.id == data.request_id || data.vendor_id.as_ref() == Some(&m.id));
        if let Some(message) = existing {
            message.id = data.request_id.clone();
            for content in &mut message.content {
                if let MessageContent::Node(MessageContentNode::Compaction { compaction, .. }) =
                    content
                {
                    *compaction = Some(data.clone());
                }
            }
        }
    }
}

fn internal_id(id: &str, uuid: &str) -> bool {
    id == uuid
        || id == format!("unknown-cmd-user-{uuid}")
        || id == format!("unknown-cmd-err-{uuid}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use mainframe_types::{chat::ChatMessageType, compaction::CompactionOrigin};
    fn message(id: &str, content: Vec<MessageContent>) -> ChatMessage {
        ChatMessage {
            id: id.into(),
            chat_id: "c".into(),
            r#type: ChatMessageType::System,
            content,
            timestamp: String::new(),
            metadata: None,
        }
    }
    #[test]
    fn idle_history_hides_only_recorded_command_and_marks_matched_boundary() {
        let request = NativeCompactionRequest {
            id: "request".into(),
            session_generation: "session".into(),
            command_uuid: "internal-command".into(),
            origin: CompactionOrigin::Idle,
        };
        let metadata = request.metadata(Some("boundary"));
        let mut messages = vec![
            message("internal-command", Vec::new()),
            message("unknown-cmd-user-internal-command", Vec::new()),
            message("real-user-compact", Vec::new()),
            message(
                "boundary",
                vec![MessageContent::Node(MessageContentNode::Compaction {
                    compaction: None,
                    parent_tool_use_id: None,
                })],
            ),
            message(
                "manual-boundary",
                vec![MessageContent::Node(MessageContentNode::Compaction {
                    compaction: None,
                    parent_tool_use_id: None,
                })],
            ),
        ];
        merge(&mut messages, &[request], std::slice::from_ref(&metadata));
        assert_eq!(
            messages.iter().map(|m| m.id.as_str()).collect::<Vec<_>>(),
            vec!["real-user-compact", "request", "manual-boundary"]
        );
        assert!(
            matches!(&messages[1].content[0],MessageContent::Node(MessageContentNode::Compaction { compaction:Some(data),.. }) if data==&metadata)
        );
        assert!(matches!(
            &messages[2].content[0],
            MessageContent::Node(MessageContentNode::Compaction {
                compaction: None,
                ..
            })
        ));
    }
}
