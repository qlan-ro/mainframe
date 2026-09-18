//! Ported from `packages/core/src/chat/permission-handler.ts`. The answer
//! path itself lives in `respond.rs` (guards + dispatch) and `branches.rs`
//! (what each outcome does); this file owns the handler's state and the
//! pending-gate lookups.

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
    /// The chat-surface observer (todo #350, plan task 17): unlike
    /// `EventHandler`, this handler owns the normal (non-cancelled)
    /// permission-answer path, so it needs its own attach point to emit
    /// `GateResolved`/`GateRaised` there — mirrors `chat_surface.rs`'s
    /// documented constructor-injection pattern (a handler with none
    /// attached is a silent no-op, not a construction-time obligation).
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
        self.permissions
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .has_pending(chat_id)
    }

    fn session_spawned(cell: &Arc<Mutex<ActiveChat>>) -> bool {
        cell.lock()
            .unwrap_or_else(|e| e.into_inner())
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
    pub fn pending_permission_as_known(&self, chat_id: &str) -> Option<ControlRequest> {
        self.permissions
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .get_pending(chat_id)
            .cloned()
    }

    pub fn has_pending_permission(&self, chat_id: &str) -> bool {
        self.has_pending(chat_id)
    }

    pub fn clear_pending_permission(&self, chat_id: &str) {
        self.permissions
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clear(chat_id);
    }
}

#[cfg(test)]
mod cancelled_guard_tests;

// PORT STATUS: src/chat/permission-handler.ts (156 lines)
// confidence: medium
// notes: TS `PermissionHandlerDeps` DI bag → `PermissionHandlerDeps` trait; the
// notes: `permissions`/`messages` PER_ENTITY caches are shared `Arc<Mutex<..>>`
// notes: (the sink task also touches them). `planMode.*` calls become three deps
// notes: methods (handle_no_process sync; clear_context/escalation async) so the
// notes: handler avoids being generic over PlanModeContext; chat_manager forwards
// notes: to its PlanModeHandler. Session I/O (respondToPermission) is cloned out of
// notes: the ActiveChat cell and awaited outside the lock (CONCURRENCY rule 4).
// notes: warn/info strings + the "No session for chat {id}" throw copied verbatim.
// notes: No dedicated TS test file (exercised via chat-manager + plan-mode paths).
// notes: (#284) `respond_to_permission`'s leading `was_cancelled` guard is a
// notes: Rust-side addition with no TS original: it drops an answer naming a
// notes: request the CLI already withdrew via `control_cancel_request`, before
// notes: even checking for an active session. See `cancelled_guard_tests.rs`.
// todos: 0
