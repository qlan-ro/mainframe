//! The in-flight assistant message's accumulated partial content
//! (`SessionSink::on_message_partial`), merged into the display computation
//! as a synthetic tail `ChatMessage` under the API message id, and dropped
//! the moment a completed block, retry, result, or exit supersedes it. Never
//! enters the `MessageCache`.
//!
//! Keyed by `(chat_id, session_id)` : a session that
//! calls `on_exit` after a newer session has already replaced it must only
//! clear its OWN overlay entry, never a chat-id-only slot a superseding
//! session already wrote to. Before this, `on_exit` racing a fresh session's
//! first `on_message_partial` could drop the wrong overlay.

use mainframe_types::sync::LockExt as _;
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
    pub presentation: Option<mainframe_types::transcript_presentation::TranscriptPresentation>,
}

fn overlay_message(chat_id: &str, overlay: &PartialOverlay) -> ChatMessage {
    use mainframe_types::transcript_presentation::{PRESENTATION_CONTEXT_KEY, PresentationState};
    let metadata = overlay.presentation.as_ref().and_then(|p| {
        serde_json::to_value(p).ok().map(|value| {
            HashMap::from([
                (PRESENTATION_CONTEXT_KEY.into(), value),
                (
                    "presentationStreaming".into(),
                    serde_json::Value::Bool(p.state == PresentationState::Running),
                ),
            ])
        })
    });
    ChatMessage {
        id: overlay.message_id.clone(),
        chat_id: chat_id.to_string(),
        r#type: ChatMessageType::Assistant,
        content: overlay.content.clone(),
        timestamp: overlay.started_at.clone(),
        metadata,
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
        self.insert_with_presentation(chat_id, session_id, message_id, content, None);
    }

    pub(crate) fn insert_with_presentation(
        &self,
        chat_id: &str,
        session_id: &str,
        message_id: &str,
        content: Vec<MessageContent>,
        presentation: Option<mainframe_types::transcript_presentation::TranscriptPresentation>,
    ) {
        let mut overlays = self.0.lock_recover();
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
                presentation,
            },
        );
    }

    pub(crate) fn update_presentation(
        &self,
        chat_id: &str,
        session_id: &str,
        update: &mainframe_types::transcript_presentation::PresentationUpdate,
    ) {
        let mut overlays = self.0.lock_recover();
        if let Some(overlay) = overlays.get_mut(&(chat_id.to_string(), session_id.to_string()))
            && update
                .source_message_ids
                .as_ref()
                .is_none_or(|ids| ids.contains(&overlay.message_id))
            && let Some(current) = overlay.presentation.as_mut()
        {
            let eligible = current.same_turn(&update.presentation)
                && current.state
                    != mainframe_types::transcript_presentation::PresentationState::Invalid;
            super::presentation::apply_update(current, &update.presentation);
            if eligible && update.source_message_ids.is_some() {
                current.phase = update.presentation.phase;
                current.final_eligible = update.presentation.final_eligible;
            }
        }
    }

    /// Remove `(chat_id, session_id)`'s overlay; reports whether one was
    /// present, so abort paths only re-emit when content actually vanishes.
    pub fn take(&self, chat_id: &str, session_id: &str) -> bool {
        self.0
            .lock_recover()
            .remove(&(chat_id.to_string(), session_id.to_string()))
            .is_some()
    }

    /// The chat's current overlay, for display computation. At most one
    /// session's overlay is live per chat outside the narrow supersession
    /// window this module closes, so the first match is exact in practice.
    pub(crate) fn message_for(&self, chat_id: &str) -> Option<ChatMessage> {
        self.0
            .lock_recover()
            .iter()
            .find(|((cid, _), _)| cid == chat_id)
            .map(|(_, overlay)| overlay_message(chat_id, overlay))
    }

    /// Chat teardown (end/archive): drop every session's overlay for this
    /// chat — nothing else clears this per-chat bookkeeping.
    pub fn remove_chat(&self, chat_id: &str) {
        self.0.lock_recover().retain(|(cid, _), _| cid != chat_id);
    }
}
