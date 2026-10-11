//! `PermissionHandlerDeps` adapter (plus the `PlanHost` impl it wraps) and its
//! sub-manager construction.
use super::*;
use mainframe_types::sync::LockExt as _;

/// Implements `PlanHost` for the plan-mode action context — the seam back into
/// `ChatManager`'s privately-typed event/lifecycle pieces. `send_message` needs a
/// live `ChatManager` (the clear-context path's follow-up "Implement the
/// following plan:" send), so it upgrades a weak self-reference rather than
/// re-implementing the send path (`attach_self` sets `self_ref`).
struct PlanHostImpl {
    event_handler: Arc<EventHandler>,
    lifecycle: Arc<ChatLifecycleManager>,
    shared: Arc<ChatShared>,
    self_ref: Arc<std::sync::OnceLock<std::sync::Weak<ChatManager>>>,
}

impl PlanHost for PlanHostImpl {
    fn emit_event(&self, event: DaemonEvent) {
        self.shared.emit(event);
    }
    fn clear_display_state(&self, chat_id: &str) {
        self.event_handler.clear_display_state(chat_id);
    }
    fn notify_transcript_cleared(&self, chat_id: &str) {
        self.event_handler.notify_chat_surface(
            crate::chat_surface::ChatSurfaceEvent::TranscriptCleared {
                chat_id: chat_id.to_string(),
            },
        );
    }
    fn start_chat<'a>(&'a self, chat_id: &'a str) -> BoxFuture<'a, ()> {
        Box::pin(async move { self.lifecycle.start_chat(chat_id).await })
    }
    fn send_message<'a>(
        &'a self,
        chat_id: &'a str,
        content: &'a str,
    ) -> BoxFuture<'a, Result<(), AdapterError>> {
        Box::pin(async move {
            let Some(manager) = self.self_ref.get().and_then(std::sync::Weak::upgrade) else {
                tracing::warn!(
                    chat_id,
                    "plan-mode follow-up send has no ChatManager — attach_self was never called"
                );
                return Err(AdapterError::Invariant(
                    "plan-mode follow-up send has no ChatManager",
                ));
            };
            manager
                .send_message(chat_id, content, None, None)
                .await
                .map_err(SendError::into_adapter_error)
        })
    }
}

pub(super) struct PhDeps {
    shared: Arc<ChatShared>,
    event_handler: Arc<EventHandler>,
    lifecycle: Arc<ChatLifecycleManager>,
    plan_mode: Arc<PlanModeHandler<ChatPlanModeCtx>>,
}

impl PermissionHandlerDeps for PhDeps {
    fn get_active_chat(&self, chat_id: &str) -> Option<Arc<Mutex<ActiveChat>>> {
        self.shared
            .active_chats
            .get(chat_id)
            .map(|e| e.value().clone())
    }
    fn start_chat<'a>(&'a self, chat_id: &'a str) -> BoxFuture<'a, ()> {
        Box::pin(async move { self.lifecycle.start_chat(chat_id).await })
    }
    fn emit_event(&self, event: DaemonEvent) {
        self.shared.emit(event);
    }
    fn emit_display(&self, chat_id: &str) {
        self.event_handler.emit_display(chat_id);
    }
    fn chats_update(&self, chat_id: &str, patch: &ChatPatch) {
        self.shared.deps.chats_update(chat_id, patch);
    }
    fn get_messages<'a>(&'a self, chat_id: &'a str) -> BoxFuture<'a, Vec<ChatMessage>> {
        // getPendingPermission calls getMessages to restore permission state from
        // JSONL. Mirrors the facade's `getMessages` disk load (cache-agnostic here —
        // the caller only scans the returned messages for a pending permission).
        Box::pin(async move {
            let chat = self
                .shared
                .active_chats
                .get(chat_id)
                .map(|c| c.lock_recover().chat.clone())
                .or_else(|| self.shared.deps.chats_get(chat_id));
            let Some(chat) = chat else {
                return Vec::new();
            };
            let Some(session) = build_history_session(&self.shared.deps, &chat, chat_id) else {
                return Vec::new();
            };
            match session.load_history().await {
                Ok(history) => remap_history(history, chat_id),
                Err(_) => Vec::new(),
            }
        })
    }
    fn should_notify_permission(&self, tool_name: Option<&str>) -> bool {
        self.shared.deps.should_notify_permission(tool_name)
    }
    fn send_push(&self, msg: PushOut) {
        self.shared.deps.send_push(msg);
    }
    fn plan_mode_handle_no_process(
        &self,
        chat_id: &str,
        active: &Arc<Mutex<ActiveChat>>,
        response: &ControlResponse,
    ) {
        self.plan_mode.handle_no_process(chat_id, active, response);
    }
    fn plan_mode_handle_clear_context<'a>(
        &'a self,
        chat_id: &'a str,
        active: Arc<Mutex<ActiveChat>>,
        response: ControlResponse,
    ) -> BoxFuture<'a, Result<(), AdapterError>> {
        Box::pin(async move {
            self.plan_mode
                .handle_clear_context(chat_id, &active, response)
                .await
        })
    }
    fn plan_mode_handle_escalation<'a>(
        &'a self,
        chat_id: &'a str,
        active: Arc<Mutex<ActiveChat>>,
        response: ControlResponse,
    ) -> BoxFuture<'a, Result<(), AdapterError>> {
        Box::pin(async move {
            self.plan_mode
                .handle_escalation(chat_id, &active, response)
                .await
        })
    }
}

pub(super) fn build(
    shared: &Arc<ChatShared>,
    event_handler: &Arc<EventHandler>,
    lifecycle: &Arc<ChatLifecycleManager>,
    self_ref: &Arc<std::sync::OnceLock<std::sync::Weak<ChatManager>>>,
) -> ChatPermissionHandler<PhDeps> {
    let permissions = &shared.permissions;
    let plan_host: Arc<dyn PlanHost> = Arc::new(PlanHostImpl {
        event_handler: event_handler.clone(),
        lifecycle: lifecycle.clone(),
        shared: shared.clone(),
        self_ref: self_ref.clone(),
    });
    let plan_mode = Arc::new(PlanModeHandler::new(ChatPlanModeCtx {
        shared: shared.clone(),
        host: plan_host,
    }));

    let ph_deps = PhDeps {
        shared: shared.clone(),
        event_handler: event_handler.clone(),
        lifecycle: lifecycle.clone(),
        plan_mode,
    };
    ChatPermissionHandler::new(permissions.clone(), shared.messages.clone(), ph_deps)
}
