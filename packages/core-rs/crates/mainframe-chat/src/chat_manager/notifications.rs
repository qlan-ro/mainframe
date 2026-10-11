use super::ChatShared;
use std::sync::Arc;

pub(crate) enum NotificationGate {
    Permission(String),
    Complete,
    Error,
    Attention,
}

impl ChatShared {
    pub(crate) fn when_notification_enabled(
        self: &Arc<Self>,
        gate: NotificationGate,
        notify: impl FnOnce() + Send + 'static,
    ) {
        let enabled = match gate {
            NotificationGate::Permission(tool) => self.deps.should_notify_permission(Some(&tool)),
            NotificationGate::Complete => self.deps.notify_task_complete(),
            NotificationGate::Error => self.deps.notify_session_error(),
            NotificationGate::Attention => self.deps.notify_attention_request(),
        };
        if enabled {
            notify();
        }
    }

    pub(crate) fn permission_push(self: &Arc<Self>, chat_id: &str, tool: &str) {
        let shared = self.clone();
        let chat_id = chat_id.to_string();
        let tool = tool.to_string();
        self.when_notification_enabled(NotificationGate::Permission(tool.clone()), move || {
            shared.deps.send_push(crate::event_handler::PushOut {
                chat_id,
                title: "Permission Required".into(),
                body: format!("Agent wants to run: {tool}"),
                push_type: "permission".into(),
                priority: "high".into(),
            });
        });
    }
}
