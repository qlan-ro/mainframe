//! The `Pusher` half of [`FakeDeps`]: the notification gates as plain flags
//! and a log of every push.

use mainframe_types::sync::LockExt as _;
use std::sync::Mutex;

use super::FakeDeps;
use crate::chat_manager::Pusher;
use crate::event_handler::PushOut;
use mainframe_adapter_api::BoxFuture;

pub(crate) struct FakePusher {
    pub(crate) settings_gate: Mutex<Option<std::sync::Arc<tokio::sync::Notify>>>,
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
            settings_gate: Mutex::new(None),
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
        self.pushes.lock_recover().clone()
    }
}

impl Pusher for FakeDeps {
    fn should_notify_permission<'a>(&'a self, _tool_name: Option<&'a str>) -> BoxFuture<'a, bool> {
        Box::pin(async { *self.push.permission.lock_recover() })
    }
    fn notify_task_complete(&self) -> BoxFuture<'_, bool> {
        Box::pin(async { *self.push.task_complete.lock_recover() })
    }
    fn notify_session_error(&self) -> BoxFuture<'_, bool> {
        Box::pin(async { *self.push.session_error.lock_recover() })
    }
    fn notify_attention_request(&self) -> BoxFuture<'_, bool> {
        Box::pin(async {
            let gate = self.push.settings_gate.lock_recover().clone();
            if let Some(gate) = gate {
                gate.notified().await;
            }
            *self.push.attention_request.lock_recover()
        })
    }
    fn send_push(&self, msg: PushOut) {
        self.push.pushes.lock_recover().push(msg);
    }
}
