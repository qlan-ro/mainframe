//! The permission handler. The answer path itself lives in `respond.rs`
//! (guards + dispatch) and `branches.rs` (what each outcome does); this file
//! owns the handler's state and the pending-gate lookups.

use mainframe_types::sync::LockExt as _;
use std::sync::{Arc, Mutex, OnceLock};

use mainframe_types::adapter::{ControlRequest, ControlResponse};
use mainframe_types::chat::ChatMessage;

use crate::chat_manager::{ChatShared, build_history_session, remap_history_for};
use crate::chat_surface::{self, ChatSurface, ChatSurfaceEvent};
use crate::event_handler::EventHandler;
use crate::lifecycle_manager::ChatLifecycleManager;
use crate::plan_mode_actions::ChatPlanModeCtx;
use crate::plan_mode_handler::PlanModeHandler;
use crate::types::ActiveChat;

mod branches;
mod error;
mod respond;

pub use error::PermissionError;

pub struct ChatPermissionHandler {
    shared: Arc<ChatShared>,
    /// Display revisions for an answer's text, and the surface it drives.
    event_handler: Arc<EventHandler>,
    /// Starts a chat that has no live session to answer the gate on.
    lifecycle: Arc<ChatLifecycleManager>,
    /// Plan-mode delegation for `ExitPlanMode` approvals.
    plan_mode: Arc<PlanModeHandler<ChatPlanModeCtx>>,
    /// The chat-surface observer: unlike `EventHandler`, this handler owns the
    /// normal (non-cancelled) permission-answer path, so it needs its own
    /// attach point to emit `GateResolved`/`GateRaised` there — mirrors
    /// `chat_surface.rs`'s documented constructor-injection pattern (a handler
    /// with none attached is a silent no-op, not a construction-time
    /// obligation).
    chat_surface: Arc<OnceLock<Arc<dyn ChatSurface>>>,
}

fn is_exit_plan_mode(response: &ControlResponse) -> bool {
    response.tool_name.as_deref() == Some("ExitPlanMode")
}

impl ChatPermissionHandler {
    pub(crate) fn new(
        shared: Arc<ChatShared>,
        event_handler: Arc<EventHandler>,
        lifecycle: Arc<ChatLifecycleManager>,
        plan_mode: Arc<PlanModeHandler<ChatPlanModeCtx>>,
    ) -> Self {
        Self {
            shared,
            event_handler,
            lifecycle,
            plan_mode,
            chat_surface: Arc::new(OnceLock::new()),
        }
    }

    /// `getPendingPermission` calls `getMessages` to restore permission state
    /// from JSONL. Mirrors the facade's `getMessages` disk load (cache-agnostic
    /// here — the caller only scans the returned messages for a pending
    /// permission).
    async fn load_messages(&self, chat_id: &str) -> Vec<ChatMessage> {
        let Some(chat) = self.shared.chat_or_db(chat_id) else {
            return Vec::new();
        };
        let Some(session) = build_history_session(&self.shared.deps, &chat, chat_id) else {
            return Vec::new();
        };
        match session.load_history().await {
            Ok(history) => remap_history_for(history, chat_id),
            Err(_) => Vec::new(),
        }
    }

    /// Attach the chat-surface observer. Idempotent-once, matching
    /// `EventHandler::set_chat_surface`.
    pub fn set_chat_surface(&self, surface: Arc<dyn ChatSurface>) {
        /* expected */
        let _ = self.chat_surface.set(surface); // First attachment wins.
    }

    fn notify_surface(&self, event: ChatSurfaceEvent) {
        chat_surface::notify(self.chat_surface.get(), event);
    }

    fn has_pending(&self, chat_id: &str) -> bool {
        self.shared.permissions.lock_recover().has_pending(chat_id)
    }

    fn session_spawned(cell: &Arc<Mutex<ActiveChat>>) -> bool {
        cell.lock_recover()
            .session
            .as_ref()
            .is_some_and(|s| s.is_spawned())
    }

    pub async fn get_pending_permission(&self, chat_id: &str) -> Option<ControlRequest> {
        if !self.has_pending(chat_id) {
            self.load_messages(chat_id).await;
        }
        self.pending_permission_as_known(chat_id)
    }

    /// The pending gate as already known, with no transcript load. For
    /// callers that just loaded the history themselves — `get_messages`
    /// restores a pending permission from it, so a second load would only
    /// repeat that work (a cold chat's whole JSONL, twice per resume).
    pub(crate) fn pending_permission_as_known(&self, chat_id: &str) -> Option<ControlRequest> {
        self.shared
            .permissions
            .lock_recover()
            .get_pending(chat_id)
            .cloned()
    }

    pub fn has_pending_permission(&self, chat_id: &str) -> bool {
        self.has_pending(chat_id)
    }
}

#[cfg(test)]
mod cancelled_guard_tests;
