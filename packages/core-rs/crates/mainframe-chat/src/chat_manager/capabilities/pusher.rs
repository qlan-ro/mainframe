use super::*;

pub trait Pusher: Send + Sync {
    fn should_notify_permission<'a>(&'a self, tool_name: Option<&'a str>) -> BoxFuture<'a, bool>;

    fn notify_task_complete(&self) -> BoxFuture<'_, bool>;

    fn notify_session_error(&self) -> BoxFuture<'_, bool>;

    fn notify_attention_request(&self) -> BoxFuture<'_, bool>;

    fn send_push(&self, _msg: PushOut) {}
}
