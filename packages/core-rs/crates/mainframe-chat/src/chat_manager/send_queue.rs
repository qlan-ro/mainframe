//! The queued-turn bookkeeping half of `send_plain_text` (todo #350, plan
//! task 37, R2.13): whether this send is queued behind a running turn, the
//! transient metadata that marks it as such, and the `QueuedMessageRef` that
//! makes it visible to `_mainframe.dev/queue_state`. Split out of `send.rs`
//! to keep that file under the 300-line cap.

use super::*;

impl ChatManager {
    pub(super) fn queued_message_metadata(
        &self,
        post: &Arc<Mutex<ActiveChat>>,
        session: &Arc<dyn AdapterSession>,
        attachment_previews: &[serde_json::Value],
    ) -> (HashMap<String, serde_json::Value>, Option<String>) {
        let adapter_acks_replay = session.supports_replay_ack();
        let is_queued = adapter_acks_replay
            && post
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .chat
                .process_state
                == Some(Some(ProcessState::Working));
        let mut transient_metadata: HashMap<String, serde_json::Value> = HashMap::new();
        if is_queued {
            transient_metadata.insert("queued".to_string(), serde_json::json!(true));
        }
        if !attachment_previews.is_empty() {
            transient_metadata.insert(
                "attachments".to_string(),
                serde_json::Value::Array(attachment_previews.to_vec()),
            );
        }
        let message_uuid = if is_queued {
            Some(nanoid::nanoid!())
        } else {
            None
        };
        if let Some(u) = &message_uuid {
            transient_metadata.insert("uuid".to_string(), serde_json::json!(u));
        }
        (transient_metadata, message_uuid)
    }

    pub(super) fn record_queued_ref(
        &self,
        chat_id: &str,
        message: &ChatMessage,
        uuid: String,
        content: &str,
        attachment_ids: Option<&[String]>,
    ) {
        let r = QueuedMessageRef {
            message_id: message.id.clone(),
            chat_id: chat_id.to_string(),
            uuid: uuid.clone(),
            content: content.to_string(),
            attachment_ids: attachment_ids.filter(|a| !a.is_empty()).map(|a| a.to_vec()),
            timestamp: message.timestamp.clone(),
        };
        self.queued_refs
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .push(r);
        self.notify_queue_changed(chat_id);
        info!(
            chat_id,
            uuid,
            message_id = message.id,
            "message sent to CLI while busy (queued)"
        );
    }
}
