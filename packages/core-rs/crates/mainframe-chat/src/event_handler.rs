use mainframe_types::sync::LockExt as _;
use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Instant;

use mainframe_adapter_api::SessionSink;
use mainframe_adapter_api::pr_detection::PrDetectionSink;
use mainframe_display::DisplayProjector;
#[cfg(test)]
use mainframe_display::FullRebuildProjector;
use mainframe_types::adapter::{
    ContextUsage, ControlRequest, DetectedPr, MessageMetadata, ProviderQuota, SessionResult,
};
use mainframe_types::chat::{
    ChatMessage, ChatMessageType, MessageContent, MessageContentNode, ProcessState,
    QueuedMessageRef, TodoItem,
};
use mainframe_types::chat_patch::ChatPatch;
use mainframe_types::content::LeafContent;
use mainframe_types::context::SkillFileEntry;
use mainframe_types::display::{DisplayMessage, StreamingLeafKind, ToolCategories};
use mainframe_types::events::{
    ChatNotificationKind, ChatNotificationLevel, ChatUpdatedReason, DaemonEvent,
};
use mainframe_types::time::now_iso8601;
use tracing::{debug, warn};

use crate::attention_request::{AttentionDedupe, normalize_attention_body};
use crate::chat_surface::{self, ChatSurface, ChatSurfaceEvent, CompactionPhase, TurnStopReason};
use crate::fork::PendingForkState;
use crate::message_cache::MessageCache;
use crate::permission_manager::{CancelOutcome, PermissionManager};
use crate::types::ActiveChat;
use display_projection::streaming_leaf_kind;
use partial_overlay::PartialOverlays;
use worktree_tool::{creates_worktree, moves_transcript};

pub(crate) mod display_projection;
mod partial_overlay;
mod worktree_tool;

const PUSH_BODY_MAX_LENGTH: usize = 200;
/// `computeSessionFilePath` — encode a cwd the Claude way and point at the jsonl.
pub fn compute_session_file_path(cwd: &str, session_id: &str) -> String {
    let encoded = mainframe_types::paths::encode_claude_project_path(cwd);
    let safe_session = mainframe_types::paths::encode_claude_project_path(session_id);
    let home = dirs::home_dir().unwrap_or_default();
    home.join(".claude")
        .join("projects")
        .join(encoded)
        .join(format!("{safe_session}.jsonl"))
        .to_string_lossy()
        .into_owned()
}

/// Truncate to [`PUSH_BODY_MAX_LENGTH`] chars, ending in an ellipsis; shared
/// with `attention_request::normalize_attention_body`.
pub(crate) fn truncate_push_body(text: &str) -> String {
    mainframe_types::chat_text::truncate_with_ellipsis(text, PUSH_BODY_MAX_LENGTH)
}

pub struct EventHandler<D: EventHandlerDeps + 'static> {
    messages: Arc<Mutex<MessageCache>>,
    permissions: Arc<Mutex<PermissionManager>>,
    partial_overlays: PartialOverlays,
    deps: Arc<D>,
    /// Survives a session resume because it is kept on the handler,
    /// not the per-session sink `build_sink` recreates.
    attention_dedupe: Arc<Mutex<AttentionDedupe>>,
    /// The chat-surface observer, attached after construction via
    /// [`EventHandler::set_chat_surface`] — mirrors
    /// `ChatManager::attach_self`'s `OnceLock` pattern so a handler built with
    /// no surface attached (most tests) is a silent no-op, not a construction
    /// error.
    chat_surface: Arc<OnceLock<Arc<dyn ChatSurface>>>,
}

impl<D: EventHandlerDeps + 'static> EventHandler<D> {
    pub fn new(
        messages: Arc<Mutex<MessageCache>>,
        permissions: Arc<Mutex<PermissionManager>>,
        deps: Arc<D>,
    ) -> Self {
        Self {
            messages,
            permissions,
            partial_overlays: PartialOverlays::new(),
            deps,
            attention_dedupe: Arc::new(Mutex::new(AttentionDedupe::default())),
            chat_surface: Arc::new(OnceLock::new()),
        }
    }

    /// Attach the chat-surface observer. Idempotent-once: a second call is a
    /// no-op (the `OnceLock` already holds the first surface), matching
    /// `attach_self`'s convention elsewhere in this crate.
    pub fn set_chat_surface(&self, surface: Arc<dyn ChatSurface>) {
        let _ = self.chat_surface.set(surface);
    }

    /// Notify the attached surface (a no-op when none is attached). Public so
    /// `ChatManager`'s send path (turn accepted/started, outside the sink)
    /// can drive the same observer the sink drives.
    pub(crate) fn notify_chat_surface(&self, event: ChatSurfaceEvent) {
        chat_surface::notify(self.chat_surface.get(), event);
    }

    /// Build the session sink for `chat_id`. The sink never answers permissions
    /// itself, so it takes no responder; chat_manager retains that callback
    /// separately.
    pub fn build_sink(
        &self,
        chat_id: &str,
        built_for_session_id: Option<String>,
    ) -> Arc<dyn SessionSink> {
        let inner: Arc<dyn SessionSink> = Arc::new(SessionSinkImpl {
            chat_id: chat_id.to_string(),
            built_for_session_id,
            messages: self.messages.clone(),
            permissions: self.permissions.clone(),
            partial_overlays: self.partial_overlays.clone(),
            deps: self.deps.clone(),
            pending_file_paths: Mutex::new(HashMap::new()),
            pending_subagent_ids: Mutex::new(HashSet::new()),
            pending_worktree_triggers: Mutex::new(HashSet::new()),
            pending_transcript_moves: Mutex::new(HashSet::new()),
            attention_dedupe: self.attention_dedupe.clone(),
            chat_surface: self.chat_surface.clone(),
        });
        // PR detection is adapter-neutral: wrapping here, the one construction
        // point every session's sink comes from, is what makes every adapter
        // inherit it — none needs its own scanning code.
        Arc::new(PrDetectionSink::new(inner))
    }

    /// Emit a display revision for a chat (code paths outside the session sink).
    pub(crate) fn emit_display(&self, chat_id: &str) {
        let categories = self.deps.get_tool_categories(chat_id);
        emit_display_for(
            chat_id,
            &self.messages,
            &self.partial_overlays,
            categories.as_ref(),
            self.deps.as_ref(),
            self.chat_surface.get(),
        );
    }

    /// Remove the chat's partial-overlay entries, every session's (call on
    /// chat end/archive) — nothing else clears this per-chat bookkeeping.
    pub fn clear_display_state(&self, chat_id: &str) {
        self.partial_overlays.remove_chat(chat_id);
    }

    /// The chat's current in-flight overlay message, for `ChatManager`'s resume
    /// snapshot — the same read `emit_display_for` uses for live revisions, so
    /// a snapshot taken mid-stream can project it through the identical step.
    pub fn current_overlay_message(&self, chat_id: &str) -> Option<ChatMessage> {
        self.partial_overlays.message_for(chat_id)
    }

    /// The resume-snapshot read: bring the chat's projection current the same
    /// way a live emission does, but without notifying — any non-empty delta
    /// this produces is stashed as the slot's pending delta and merged into the
    /// next live emission (`MessageCache::display_snapshot`). Returns the
    /// materialized container list and the overlay's streaming kind, if any.
    ///
    /// `raw` is the caller's own freshly-read history (`ChatManager::get_messages`'s
    /// return), not re-derived from the cache: a cold load past `MAX_CHATS`
    /// can evict its own cache entry again immediately
    /// (`history_eviction.rs`), and the snapshot must still reflect what was
    /// just loaded.
    pub fn display_snapshot(
        &self,
        chat_id: &str,
        raw: &[ChatMessage],
    ) -> (Vec<DisplayMessage>, Option<StreamingLeafKind>) {
        let categories = self.deps.get_tool_categories(chat_id);
        let overlay = self.partial_overlays.message_for(chat_id);
        let mut msgs = self.messages.lock_recover();
        let materialized =
            msgs.display_snapshot(chat_id, raw, overlay.as_ref(), categories.as_ref(), || {
                self.deps.display_projector()
            });
        let streaming = overlay
            .as_ref()
            .and_then(|o| streaming_leaf_kind(Some(o), materialized.last()));
        (materialized, streaming)
    }
}

struct SessionSinkImpl<D: EventHandlerDeps + 'static> {
    chat_id: String,
    built_for_session_id: Option<String>,
    messages: Arc<Mutex<MessageCache>>,
    permissions: Arc<Mutex<PermissionManager>>,
    partial_overlays: PartialOverlays,
    deps: Arc<D>,
    pending_file_paths: Mutex<HashMap<String, String>>,
    pending_subagent_ids: Mutex<HashSet<String>>,
    pending_worktree_triggers: Mutex<HashSet<String>>,
    pending_transcript_moves: Mutex<HashSet<String>>,
    attention_dedupe: Arc<Mutex<AttentionDedupe>>,
    chat_surface: Arc<OnceLock<Arc<dyn ChatSurface>>>,
}

use mainframe_types::time::now_ms;

#[cfg(test)]
mod attention_tests;

#[cfg(test)]
mod chat_surface_tests;

#[cfg(test)]
mod partial_overlay_tests;

#[cfg(test)]
mod worktree_trigger_tests;

#[cfg(test)]
mod permission_cancel_tests;

#[cfg(test)]
mod pr_detection_wiring_tests;

#[cfg(test)]
mod stable_id_characterization_tests;

#[cfg(test)]
#[path = "event_handler/tests/support.rs"]
mod tests;

mod tool_timing;
#[cfg(test)]
mod tool_timing_tests;

mod deps;
pub use deps::{EventHandlerDeps, PushOut};
mod display_emission;
use display_emission::emit_display_for;
mod sink;
mod sink_exit;
mod sink_messages;
mod sink_metadata;
mod sink_notifications;
mod sink_permissions;
mod sink_queue;
mod sink_result;
mod sink_segments;
mod sink_tools;

mod presentation;
#[cfg(test)]
mod presentation_tests;

mod sink_result_notifications;
