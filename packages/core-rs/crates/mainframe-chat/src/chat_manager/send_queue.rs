//! The queued-turn bookkeeping half of `send_plain_text` (todo #350, plan
//! task 37, R2.13): whether this send is queued behind a running turn, the
//! transient metadata that marks it as such, and the `QueuedMessageRef` that
//! makes it visible to `_mainframe.dev/queue_state`. Split out of `send.rs`
//! to keep that file under the 300-line cap.

use super::*;

impl ChatManager {
    /// Returns the transient metadata for this send, the uuid to force on the
    /// CLI's stdin `user` payload, and whether the send is queued (busy-turn
    /// bookkeeping only).
    ///
    /// The uuid is now minted unconditionally, not just for a queued send:
    /// history reconstruction's `id_or_nanoid` reads the transcript entry's
    /// own `uuid` for a human-typed prompt (`history_converters.rs`), so an
    /// unforced send commits to a daemon-minted nanoid the CLI can never
    /// reproduce on reload — the one causal gap `docs/specs/2026-09-25-todo-
    /// 178-idle-whole-chat-offload.md` decision 10 requires closed at the
    /// source rather than excepted in the golden test. Forcing the uuid here
    /// reuses the exact mechanism the queued path already relies on for
    /// "replay parity" (`build_user_payload`'s `uuid` field), just without
    /// gating it on `is_queued`. Only the QUEUED bookkeeping (the `queued`/
    /// `uuid` transient-metadata flags `on_queued_processed` matches on, and
    /// `record_queued_ref`) stays conditional — an immediate send has no
    /// queue entry to drain.
    pub(super) fn queued_message_metadata(
        &self,
        post: &Arc<Mutex<ActiveChat>>,
        session: &Arc<dyn AdapterSession>,
        attachment_previews: &[serde_json::Value],
    ) -> (HashMap<String, serde_json::Value>, String, bool) {
        let adapter_acks_replay = session.supports_replay_ack();
        let is_queued = adapter_acks_replay
            && post
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .chat
                .process_state
                == Some(Some(ProcessState::Working));
        let mut transient_metadata: HashMap<String, serde_json::Value> = HashMap::new();
        if !attachment_previews.is_empty() {
            transient_metadata.insert(
                "attachments".to_string(),
                serde_json::Value::Array(attachment_previews.to_vec()),
            );
        }
        let message_uuid = nanoid::nanoid!();
        if is_queued {
            transient_metadata.insert("queued".to_string(), serde_json::json!(true));
            transient_metadata.insert("uuid".to_string(), serde_json::json!(message_uuid));
        }
        (transient_metadata, message_uuid, is_queued)
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
