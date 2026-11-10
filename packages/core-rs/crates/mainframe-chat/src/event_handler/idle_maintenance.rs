use super::*;
use mainframe_types::compaction::CompactionMetadata;

impl SessionSinkImpl {
    pub(super) fn handle_idle_compact(&self, metadata: CompactionMetadata) {
        if self.shared.active(&self.chat_id).is_none_or(|cell| {
            cell.lock_recover()
                .session
                .as_ref()
                .is_none_or(|s| s.id() != metadata.session_generation)
        }) {
            return;
        }
        if !self.shared.maintenance.matches(&self.chat_id, &metadata) {
            return;
        }
        match self.shared.deps.idle_record(&self.chat_id, &metadata) {
            Ok(true) => {}
            Ok(false) => return,
            Err(_) => {
                warn!(
                    chat_id = self.chat_id,
                    "idle compaction provenance persistence failed"
                );
                return;
            }
        }
        let message = match self.shared.deps.idle_markers(&self.chat_id) {
            Ok(markers) => markers.into_iter().find(|m| m.content.iter().any(|c| matches!(c,
                MessageContent::Node(MessageContentNode::Compaction { compaction: Some(data), .. }) if data.request_id == metadata.request_id))),
            Err(_) => { warn!(chat_id = self.chat_id, "idle marker reload failed"); None }
        };
        let Some(message) = message else {
            return;
        };
        self.messages.lock_recover().append(&self.chat_id, message);
        self.emit_display();
    }
}
