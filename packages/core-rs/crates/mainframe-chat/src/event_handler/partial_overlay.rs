//! The in-flight assistant message's accumulated partial content
//! (`SessionSink::on_message_partial`), merged into the display computation
//! as a synthetic tail `ChatMessage` under the API message id, and dropped
//! the moment a completed block, retry, result, or exit supersedes it. Never
//! enters the `MessageCache`.
//!
//! Keyed by `(chat_id, session_id)` (todo #350, T13, R3.19): a session that
//! calls `on_exit` after a newer session has already replaced it must only
//! clear its OWN overlay entry, never a chat-id-only slot a superseding
//! session already wrote to. Before this, `on_exit` racing a fresh session's
//! first `on_message_partial` could drop the wrong overlay.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use mainframe_runtime::time::now_iso8601;
use mainframe_types::chat::{ChatMessage, ChatMessageType, MessageContent};

#[derive(Debug, Clone)]
pub struct PartialOverlay {
    pub message_id: String,
    pub content: Vec<MessageContent>,
    /// When this overlay's message id was first seen for this `(chat,
    /// session)` slot — frozen across every later partial for the same
    /// message, so the synthetic `ChatMessage`'s timestamp (and, through it,
    /// the group it opens) does not drift between partials (spec Decision
    /// 39: "the overlay's timestamp is fixed at its first partial").
    pub started_at: String,
}

fn overlay_message(chat_id: &str, overlay: &PartialOverlay) -> ChatMessage {
    ChatMessage {
        id: overlay.message_id.clone(),
        chat_id: chat_id.to_string(),
        r#type: ChatMessageType::Assistant,
        content: overlay.content.clone(),
        timestamp: overlay.started_at.clone(),
        metadata: None,
    }
}

#[derive(Clone, Default)]
pub struct PartialOverlays(Arc<Mutex<HashMap<(String, String), PartialOverlay>>>);

impl PartialOverlays {
    pub fn new() -> Self {
        Self::default()
    }

    /// Insert or extend `(chat_id, session_id)`'s overlay with `message_id`'s
    /// latest `content`. Keeps the existing `started_at` when the slot
    /// already holds the SAME message id — a later partial for a message
    /// already streaming, not a fresh one.
    pub fn insert(
        &self,
        chat_id: &str,
        session_id: &str,
        message_id: &str,
        content: Vec<MessageContent>,
    ) {
        let mut overlays = self.0.lock().unwrap_or_else(|e| e.into_inner());
        let key = (chat_id.to_string(), session_id.to_string());
        let started_at = match overlays.get(&key) {
            Some(existing) if existing.message_id == message_id => existing.started_at.clone(),
            _ => now_iso8601(),
        };
        overlays.insert(
            key,
            PartialOverlay {
                message_id: message_id.to_string(),
                content,
                started_at,
            },
        );
    }

    /// Remove `(chat_id, session_id)`'s overlay; reports whether one was
    /// present, so abort paths only re-emit when content actually vanishes.
    pub fn take(&self, chat_id: &str, session_id: &str) -> bool {
        self.0
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(&(chat_id.to_string(), session_id.to_string()))
            .is_some()
    }

    /// The chat's current overlay, for display computation. At most one
    /// session's overlay is live per chat outside the narrow supersession
    /// window this module closes, so the first match is exact in practice.
    pub fn message_for(&self, chat_id: &str) -> Option<ChatMessage> {
        self.0
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .iter()
            .find(|((cid, _), _)| cid == chat_id)
            .map(|(_, overlay)| overlay_message(chat_id, overlay))
    }

    /// Chat teardown (end/archive): drop every session's overlay for this
    /// chat — nothing else clears this per-chat bookkeeping.
    pub fn remove_chat(&self, chat_id: &str) {
        self.0
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .retain(|(cid, _), _| cid != chat_id);
    }
}
