use super::*;

impl<D: EventHandlerDeps + 'static> SessionSinkImpl<D> {
    pub(super) fn handle_permission(&self, request: ControlRequest) {
        let is_first = self
            .permissions
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .enqueue(&self.chat_id, request.clone());
        if is_first {
            let notify = self.deps.should_notify_permission(Some(&request.tool_name));
            self.notify_surface(ChatSurfaceEvent::GateRaised {
                chat_id: self.chat_id.clone(),
                request: request.clone(),
            });
            if let Some(cell) = self.deps.get_active_chat(&self.chat_id) {
                let chat = cell.lock().unwrap_or_else(|e| e.into_inner()).chat.clone();
                self.deps
                    .emit_event(DaemonEvent::ChatUpdated { chat, reason: None });
            }
            if notify {
                let tool = &request.tool_name;
                self.deps.send_push(PushOut {
                    chat_id: self.chat_id.clone(),
                    title: "Permission Required".to_string(),
                    body: format!("Agent wants to run: {tool}"),
                    push_type: "permission".to_string(),
                    priority: "high".to_string(),
                });
            }
        }
    }

    pub(super) fn handle_permission_cancelled(&self, request_id: &str) {
        let outcome = self
            .permissions
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .cancel(&self.chat_id, request_id);

        let was_front = matches!(outcome, CancelOutcome::Front { .. });
        let next = match outcome {
            CancelOutcome::Unknown => {
                debug!(
                    chat_id = self.chat_id,
                    request_id, "permission cancel for an unknown or already-resolved request"
                );
                return;
            }
            CancelOutcome::Queued => None,
            CancelOutcome::Front { next } => next,
        };

        self.notify_surface(ChatSurfaceEvent::GateResolved {
            chat_id: self.chat_id.clone(),
            request_id: request_id.to_string(),
        });
        if was_front {
            self.promote_next(next);
        }
    }
}
