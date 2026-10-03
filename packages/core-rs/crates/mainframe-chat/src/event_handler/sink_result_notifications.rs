use super::*;

impl<D: EventHandlerDeps + 'static> SessionSinkImpl<D> {
    pub(super) fn result_notifications(
        &self,
        data: &SessionResult,
        cost: f64,
        was_interrupted: bool,
        is_error: bool,
    ) {
        if is_error {
            if !was_interrupted {
                self.notify_result_error(data);
            }
        } else if self.deps.notify_task_complete() {
            self.notify_result_complete(cost);
        }
    }
    fn notify_result_error(&self, data: &SessionResult) {
        let detail = data
            .result
            .as_deref()
            .map(|s| s.trim().to_string())
            .unwrap_or_default();
        warn!(
            chat_id = self.chat_id,
            subtype = ?data.subtype,
            "session ended unexpectedly — emitting error message"
        );
        let msg_text = if detail.is_empty() {
            "Session ended unexpectedly".to_string()
        } else {
            detail
        };
        let message = self.transient(
            ChatMessageType::Error,
            vec![MessageContent::Node(MessageContentNode::Error {
                message: msg_text,
                parent_tool_use_id: None,
            })],
            None,
        );
        self.append_and_display(message);

        if self.deps.notify_session_error() {
            self.deps.emit_event(DaemonEvent::ChatNotification {
                chat_id: self.chat_id.clone(),
                title: "Session Error".to_string(),
                body: "A session ended unexpectedly".to_string(),
                level: ChatNotificationLevel::Error,
                kind: Some(ChatNotificationKind::SessionError),
            });
            self.deps.send_push(PushOut {
                chat_id: self.chat_id.clone(),
                title: "Session Error".to_string(),
                body: "A session ended unexpectedly".to_string(),
                push_type: "error".to_string(),
                priority: "high".to_string(),
            });
        }
    }
    fn notify_result_complete(&self, cost: f64) {
        let last_text = {
            let msgs = self.messages.lock().unwrap_or_else(|e| e.into_inner());
            get_last_assistant_text(msgs.get(&self.chat_id))
        };
        let body = if last_text.is_empty() {
            format!("Session finished (cost: ${cost:.4})")
        } else {
            last_text
        };
        self.deps.emit_event(DaemonEvent::ChatNotification {
            chat_id: self.chat_id.clone(),
            title: "Task Complete".to_string(),
            body: body.clone(),
            level: ChatNotificationLevel::Success,
            kind: Some(ChatNotificationKind::TaskComplete),
        });
        self.deps.send_push(PushOut {
            chat_id: self.chat_id.clone(),
            title: "Task Complete".to_string(),
            body,
            push_type: "task_complete".to_string(),
            priority: "default".to_string(),
        });
    }
}
