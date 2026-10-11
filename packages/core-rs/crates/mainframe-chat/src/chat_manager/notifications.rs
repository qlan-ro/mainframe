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

impl super::ChatManager {
    pub fn set_notification_config(&self, config: mainframe_types::settings::NotificationConfig) {
        self.shared.deps.set_notification_config(config);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn notification_callbacks_do_not_read_settings() {
        let deps = crate::test_support::FakeDeps::arc();
        let shared = ChatShared::new(deps.clone());
        for gate in [
            NotificationGate::Permission("Bash".into()),
            NotificationGate::Complete,
            NotificationGate::Error,
            NotificationGate::Attention,
        ] {
            shared.when_notification_enabled(gate, || {});
        }
        assert_eq!(
            deps.settings_calls
                .load(std::sync::atomic::Ordering::SeqCst),
            0
        );
        assert!(deps.store.updates.lock().unwrap().is_empty());
    }
}
