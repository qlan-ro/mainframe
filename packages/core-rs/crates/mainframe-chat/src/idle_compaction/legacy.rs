use super::*;

impl IdleCompactor {
    pub(super) fn boundary_count(&self, chat_id: &str) -> usize {
        self.shared
            .messages
            .lock_recover()
            .get(chat_id)
            .map_or(0, |messages| {
                messages.iter().filter(|m| is_boundary(m)).count()
            })
    }

    pub(super) async fn correlate_legacy(
        &self,
        chat_id: &str,
        session: &Arc<dyn AdapterSession>,
        mut metadata: CompactionMetadata,
        boundaries: usize,
    ) {
        if metadata.vendor_id.is_some() || session.adapter_id() != "codex" {
            return;
        }
        let history = match session.load_history().await {
            Ok(history) => history,
            Err(_) => {
                tracing::warn!(chat_id, "idle boundary correlation unavailable");
                return;
            }
        };
        let native: Vec<_> = history.iter().filter(|m| is_boundary(m)).collect();
        // The reservation excludes newer turns; exactly one new boundary proves this request's id.
        if native.len() != boundaries + 1 {
            return;
        }
        metadata.vendor_id = native.last().map(|m| m.id.clone());
        if let Some(id) = &metadata.vendor_id {
            session.remember_compaction_boundary(id);
        }
        if self.shared.deps.idle_record(chat_id, &metadata).is_err() {
            tracing::warn!(chat_id, "idle boundary correlation persistence failed");
        }
    }
}

fn is_boundary(message: &ChatMessage) -> bool {
    message.content.iter().any(|c| {
        matches!(
            c,
            MessageContent::Node(MessageContentNode::Compaction { .. })
        )
    })
}
