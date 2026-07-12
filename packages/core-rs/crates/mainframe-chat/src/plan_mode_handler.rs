//! Ported from `packages/core/src/chat/plan-mode-handler.ts`.

use std::sync::{Arc, Mutex};

use mainframe_adapter_api::{AdapterError, PlanActionContext, PlanModeActionHandler};
use mainframe_types::adapter::ControlResponse;
use mainframe_types::events::DaemonEvent;
use mainframe_types::settings::ExecutionMode;
use tracing::warn;

use crate::types::ActiveChat;

/// The dependency surface (mirrors the TS `PlanModeContext` object bag).
///
/// The TS `buildActionContext` assembles a `PlanActionContext` from
/// `db`/`messages`/`permissions`/`active.session`; here that assembly is provided
/// by `action_context` (chat_manager implements it — it owns those pieces). The
/// adapter's `createPlanModeHandler()` (not yet on the ported Adapter trait —
/// deferred in adapter-api) is abstracted behind `resolve_plan_mode_handler`.
pub trait PlanModeContext: Send + Sync {
    /// `db.chats.update(chatId, { permissionMode, planMode })`.
    fn chats_update(&self, chat_id: &str, permission_mode: ExecutionMode, plan_mode: bool);
    fn emit_event(&self, event: DaemonEvent);
    /// `adapter?.createPlanModeHandler()` — `None` when the adapter has no handler.
    fn resolve_plan_mode_handler(&self, adapter_id: &str)
    -> Option<Arc<dyn PlanModeActionHandler>>;
    /// `buildActionContext(chatId, active)`.
    fn action_context(&self, chat_id: &str) -> Arc<dyn PlanActionContext>;
}

/// Adapter-agnostic dispatcher for plan-mode actions.
///
/// Runtime behavior is delegated to the adapter's `createPlanModeHandler()`
/// factory (see `PlanModeActionHandler`). The dispatcher only preserves the
/// direct no-process permissionMode/planMode update — there is no live session
/// to act on at that point so the adapter handler has nothing to run.
pub struct PlanModeHandler<C: PlanModeContext> {
    ctx: C,
}

impl<C: PlanModeContext> PlanModeHandler<C> {
    pub fn new(ctx: C) -> Self {
        Self { ctx }
    }

    /// No active session path. Persist the chosen execution mode and clear
    /// planMode so a follow-up spawn starts out of plan. The adapter handler is
    /// intentionally NOT invoked here — there is no session for it to manipulate.
    pub fn handle_no_process(
        &self,
        chat_id: &str,
        active: &Arc<Mutex<ActiveChat>>,
        response: &ControlResponse,
    ) {
        let exec = response.execution_mode.unwrap_or(ExecutionMode::Default);
        let snapshot = {
            let mut guard = active.lock().unwrap_or_else(|e| e.into_inner());
            if Some(exec) != guard.chat.permission_mode || guard.chat.plan_mode == Some(true) {
                guard.chat.permission_mode = Some(exec);
                guard.chat.plan_mode = Some(false);
                Some(guard.chat.clone())
            } else {
                None
            }
        };
        if let Some(chat) = snapshot {
            self.ctx.chats_update(chat_id, exec, false);
            self.ctx
                .emit_event(DaemonEvent::ChatUpdated { chat, reason: None });
        }
    }

    /// User approved AND asked to clear context. Delegates to the adapter handler.
    pub async fn handle_clear_context(
        &self,
        chat_id: &str,
        active: &Arc<Mutex<ActiveChat>>,
        response: ControlResponse,
    ) -> Result<(), AdapterError> {
        let adapter_id = active
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .chat
            .adapter_id
            .clone();
        let Some(handler) = self.ctx.resolve_plan_mode_handler(&adapter_id) else {
            warn!(chat_id, adapter_id, "no plan-mode handler for adapter");
            return Ok(());
        };
        let action_ctx = self.ctx.action_context(chat_id);
        handler
            .on_approve_and_clear_context(response, action_ctx.as_ref())
            .await
    }

    /// User approved without clearing context. Delegates to the adapter handler.
    pub async fn handle_escalation(
        &self,
        chat_id: &str,
        active: &Arc<Mutex<ActiveChat>>,
        response: ControlResponse,
    ) -> Result<(), AdapterError> {
        let adapter_id = active
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .chat
            .adapter_id
            .clone();
        let Some(handler) = self.ctx.resolve_plan_mode_handler(&adapter_id) else {
            warn!(chat_id, adapter_id, "no plan-mode handler for adapter");
            return Ok(());
        };
        let action_ctx = self.ctx.action_context(chat_id);
        handler.on_approve(response, action_ctx.as_ref()).await
    }
}

// PORT STATUS: src/chat/plan-mode-handler.ts (90 lines)
// confidence: medium
// todos: 0
// notes: TS `PlanModeContext` DI bag → `PlanModeContext` trait. `resolveHandler`
// notes: (`adapter.createPlanModeHandler()`) → `resolve_plan_mode_handler` — the
// notes: adapter method is deferred on the ported Adapter trait (adapter-api TODO),
// notes: so it is abstracted here. `buildActionContext(chatId, active)` →
// notes: `action_context(chat_id)` (chat_manager owns the db/messages/permissions/
// notes: session pieces the PlanActionContext exposes; it re-resolves `active` by id
// notes: — minor deviation from passing it in). handleNoProcess mutates the shared
// notes: ActiveChat cell under a short lock and emits after drop (CONCURRENCY rule 3);
// notes: warn strings copied verbatim (logger name `chat:plan-mode` → tracing target).
// notes: on_approve* errors propagate (TS awaits them). No TS test file.
