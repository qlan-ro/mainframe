//! `PermissionHandlerDeps` adapter (plus the `PlanHost` impl it wraps) and its
//! sub-manager construction.
use super::*;

/// Implements `PlanHost` for the plan-mode action context — the seam back into
/// `ChatManager`'s privately-typed event/lifecycle pieces. `send_message` needs a
/// live `ChatManager` (the clear-context path's follow-up "Implement the
/// following plan:" send), so it upgrades a weak self-reference rather than
/// re-implementing the send path (T5 wires `self_ref`; see `attach_self`).
struct PlanHostImpl {
    event_handler: Arc<EventHandler<EhDeps>>,
    lifecycle: Arc<ChatLifecycleManager<LcDeps>>,
    deps: Arc<dyn ChatManagerDeps>,
    permissions: Arc<Mutex<PermissionManager>>,
    self_ref: Arc<std::sync::OnceLock<std::sync::Weak<ChatManager>>>,
}

impl PlanHost for PlanHostImpl {
    fn emit_event(&self, event: DaemonEvent) {
        enrich_and_emit(self.deps.as_ref(), &self.permissions, event);
    }
    fn clear_display_cache(&self, chat_id: &str) {
        self.event_handler.clear_display_cache(chat_id);
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
                return Err(AdapterError::Message(
                    "plan-mode follow-up send has no ChatManager".to_string(),
                ));
            };
            manager
                .send_message(chat_id, content, None, None)
                .await
                .map_err(|e| AdapterError::Message(e.0))
        })
    }
}

pub(super) struct PhDeps {
    deps: Arc<dyn ChatManagerDeps>,
    active_chats: Registry,
    permissions: Arc<Mutex<PermissionManager>>,
    event_handler: Arc<EventHandler<EhDeps>>,
    lifecycle: Arc<ChatLifecycleManager<LcDeps>>,
    plan_mode: Arc<PlanModeHandler<ChatPlanModeCtx>>,
}

impl PermissionHandlerDeps for PhDeps {
    fn get_active_chat(&self, chat_id: &str) -> Option<Arc<Mutex<ActiveChat>>> {
        self.active_chats.get(chat_id).map(|e| e.value().clone())
    }
    fn start_chat<'a>(&'a self, chat_id: &'a str) -> BoxFuture<'a, ()> {
        Box::pin(async move { self.lifecycle.start_chat(chat_id).await })
    }
    fn emit_event(&self, event: DaemonEvent) {
        enrich_and_emit(self.deps.as_ref(), &self.permissions, event);
    }
    fn emit_display(&self, chat_id: &str) {
        self.event_handler.emit_display(chat_id);
    }
    fn chats_update(&self, chat_id: &str, patch: &EventChatUpdate) {
        self.deps.chats_update(chat_id, &ChatUpdate::from(patch));
    }
    fn get_messages<'a>(&'a self, chat_id: &'a str) -> BoxFuture<'a, Vec<ChatMessage>> {
        // getPendingPermission calls getMessages to restore permission state from
        // JSONL. Mirrors the facade's `getMessages` disk load (cache-agnostic here —
        // the caller only scans the returned messages for a pending permission).
        Box::pin(async move {
            let chat = self
                .active_chats
                .get(chat_id)
                .map(|c| c.lock().unwrap_or_else(|e| e.into_inner()).chat.clone())
                .or_else(|| self.deps.chats_get(chat_id));
            let Some(chat) = chat else {
                return Vec::new();
            };
            let Some(session) = build_history_session(&self.deps, &chat, chat_id) else {
                return Vec::new();
            };
            match session.load_history().await {
                Ok(history) => remap_history(history, chat_id),
                Err(_) => Vec::new(),
            }
        })
    }
    fn should_notify_permission(&self, tool_name: Option<&str>) -> bool {
        self.deps.should_notify_permission(tool_name)
    }
    fn send_push(&self, msg: PushOut) {
        self.deps.send_push(msg);
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
    deps: &Arc<dyn ChatManagerDeps>,
    active_chats: &Registry,
    messages: &Arc<Mutex<MessageCache>>,
    permissions: &Arc<Mutex<PermissionManager>>,
    event_handler: &Arc<EventHandler<EhDeps>>,
    lifecycle: &Arc<ChatLifecycleManager<LcDeps>>,
    self_ref: &Arc<std::sync::OnceLock<std::sync::Weak<ChatManager>>>,
) -> ChatPermissionHandler<PhDeps> {
    let plan_host: Arc<dyn PlanHost> = Arc::new(PlanHostImpl {
        event_handler: event_handler.clone(),
        lifecycle: lifecycle.clone(),
        deps: deps.clone(),
        permissions: permissions.clone(),
        self_ref: self_ref.clone(),
    });
    let plan_mode = Arc::new(PlanModeHandler::new(ChatPlanModeCtx {
        deps: deps.clone(),
        active_chats: active_chats.clone(),
        messages: messages.clone(),
        permissions: permissions.clone(),
        host: plan_host,
    }));

    let ph_deps = PhDeps {
        deps: deps.clone(),
        active_chats: active_chats.clone(),
        permissions: permissions.clone(),
        event_handler: event_handler.clone(),
        lifecycle: lifecycle.clone(),
        plan_mode,
    };
    ChatPermissionHandler::new(permissions.clone(), messages.clone(), ph_deps)
}
