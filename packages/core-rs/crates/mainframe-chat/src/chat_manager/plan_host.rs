//! The `PlanHost` impl the plan-mode action context runs on, and the
//! permission handler's construction around it.
use super::*;

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

pub(super) fn build(
    shared: &Arc<ChatShared>,
    event_handler: &Arc<EventHandler>,
    lifecycle: &Arc<ChatLifecycleManager>,
    self_ref: &Arc<std::sync::OnceLock<std::sync::Weak<ChatManager>>>,
) -> ChatPermissionHandler {
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
    ChatPermissionHandler::new(
        shared.clone(),
        event_handler.clone(),
        lifecycle.clone(),
        plan_mode,
    )
}
