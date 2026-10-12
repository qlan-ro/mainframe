use super::*;

impl SessionSinkImpl {
    pub(super) fn handle_permission(&self, request: ControlRequest) {
        let is_first = self
            .permissions
            .lock_recover()
            .enqueue(&self.chat_id, request.clone());
        if is_first {
            self.notify_surface(ChatSurfaceEvent::GateRaised {
                chat_id: self.chat_id.clone(),
                request: request.clone(),
            });
            if let Some(cell) = self.shared.active(&self.chat_id) {
                let chat = cell.lock_recover().chat.clone();
                self.shared
                    .emit(DaemonEvent::ChatUpdated { chat, reason: None });
            }
            self.shared
                .permission_push(&self.chat_id, &request.tool_name);
        }
    }

    pub(super) fn handle_permission_cancelled(&self, request_id: &str) {
        let outcome = self
            .permissions
            .lock_recover()
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
