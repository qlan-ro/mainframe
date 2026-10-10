//! The permission handler. The answer path itself lives in `respond.rs`
//! (guards + dispatch) and `branches.rs` (what each outcome does); this file
//! owns the handler's state and the pending-gate lookups.

use mainframe_types::sync::LockExt as _;
use std::sync::{Arc, Mutex, OnceLock};

use mainframe_types::adapter::{ControlRequest, ControlResponse};

use crate::chat_surface::{self, ChatSurface, ChatSurfaceEvent};
use crate::message_cache::MessageCache;
use crate::permission_manager::PermissionManager;
use crate::types::ActiveChat;

mod branches;
mod deps;
mod respond;

pub use deps::{PermissionError, PermissionHandlerDeps};

pub struct ChatPermissionHandler<D: PermissionHandlerDeps> {
    permissions: Arc<Mutex<PermissionManager>>,
    messages: Arc<Mutex<MessageCache>>,
    deps: D,
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

impl<D: PermissionHandlerDeps> ChatPermissionHandler<D> {
    pub fn new(
        permissions: Arc<Mutex<PermissionManager>>,
        messages: Arc<Mutex<MessageCache>>,
        deps: D,
    ) -> Self {
        Self {
            permissions,
            messages,
            deps,
            chat_surface: Arc::new(OnceLock::new()),
        }
    }

    /// Attach the chat-surface observer. Idempotent-once, matching
    /// `EventHandler::set_chat_surface`.
    pub fn set_chat_surface(&self, surface: Arc<dyn ChatSurface>) {
        let _ = self.chat_surface.set(surface);
    }

    fn notify_surface(&self, event: ChatSurfaceEvent) {
        chat_surface::notify(self.chat_surface.get(), event);
    }

    fn has_pending(&self, chat_id: &str) -> bool {
        self.permissions.lock_recover().has_pending(chat_id)
    }

    fn session_spawned(cell: &Arc<Mutex<ActiveChat>>) -> bool {
        cell.lock_recover()
            .session
            .as_ref()
            .is_some_and(|s| s.is_spawned())
    }

    pub async fn get_pending_permission(&self, chat_id: &str) -> Option<ControlRequest> {
        if !self.has_pending(chat_id) {
            let _ = self.deps.get_messages(chat_id).await;
        }
        self.pending_permission_as_known(chat_id)
    }

    /// The pending gate as already known, with no transcript load. For
    /// callers that just loaded the history themselves — `get_messages`
    /// restores a pending permission from it, so a second load would only
    /// repeat that work (a cold chat's whole JSONL, twice per resume).
    pub(crate) fn pending_permission_as_known(&self, chat_id: &str) -> Option<ControlRequest> {
        self.permissions
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
