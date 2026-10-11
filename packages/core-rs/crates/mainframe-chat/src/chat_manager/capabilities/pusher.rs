use super::*;

pub trait Pusher: Send + Sync {
    fn set_notification_config(&self, _config: mainframe_types::settings::NotificationConfig) {}

    fn should_notify_permission(&self, tool_name: Option<&str>) -> bool;

    fn notify_task_complete(&self) -> bool;

    fn notify_session_error(&self) -> bool;

    fn notify_attention_request(&self) -> bool;

    fn send_push(&self, _msg: PushOut) {}
}
