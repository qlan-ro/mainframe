//! The `Pusher` half of [`FakeDeps`]: the notification gates as plain flags
//! and a log of every push.

use std::sync::Mutex;

use super::FakeDeps;
use crate::chat_manager::Pusher;
use crate::event_handler::PushOut;

pub(crate) struct FakePusher {
    pub(crate) permission: Mutex<bool>,
    pub(crate) task_complete: Mutex<bool>,
    pub(crate) session_error: Mutex<bool>,
    pub(crate) attention_request: Mutex<bool>,
    /// Every `send_push` call, in order.
    pub(crate) pushes: Mutex<Vec<PushOut>>,
}

impl Default for FakePusher {
    fn default() -> Self {
        Self {
            permission: Mutex::new(false),
            task_complete: Mutex::new(false),
            session_error: Mutex::new(false),
            attention_request: Mutex::new(true),
            pushes: Mutex::new(Vec::new()),
        }
    }
}

impl FakePusher {}

impl FakePusher {
    pub(crate) fn pushes(&self) -> Vec<PushOut> {
        self.pushes.lock().unwrap().clone()
    }
}

impl Pusher for FakeDeps {
    fn should_notify_permission(&self, _tool_name: Option<&str>) -> bool {
        *self.push.permission.lock().unwrap()
    }
    fn notify_task_complete(&self) -> bool {
        *self.push.task_complete.lock().unwrap()
    }
    fn notify_session_error(&self) -> bool {
        *self.push.session_error.lock().unwrap()
    }
    fn notify_attention_request(&self) -> bool {
        *self.push.attention_request.lock().unwrap()
    }
    fn send_push(&self, msg: PushOut) {
        self.push.pushes.lock().unwrap().push(msg);
    }
}
