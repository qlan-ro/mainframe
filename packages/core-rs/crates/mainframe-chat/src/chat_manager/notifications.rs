use super::ChatShared;
use std::future::Future;
use std::sync::Arc;
use std::task::{Context, Waker};

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
        let shared = self.clone();
        let mut pending = Box::pin(async move {
            let enabled = match gate {
                NotificationGate::Permission(tool) => {
                    shared.deps.should_notify_permission(Some(&tool)).await
                }
                NotificationGate::Complete => shared.deps.notify_task_complete().await,
                NotificationGate::Error => shared.deps.notify_session_error().await,
                NotificationGate::Attention => shared.deps.notify_attention_request().await,
            };
            if enabled {
                notify();
            }
        });
        // Ready settings need no task; actor reads resume without blocking the sink.
        if pending
            .as_mut()
            .poll(&mut Context::from_waker(Waker::noop()))
            .is_pending()
        {
            tokio::spawn(pending);
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
