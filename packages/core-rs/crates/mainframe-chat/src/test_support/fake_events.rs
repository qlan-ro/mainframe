//! The `EventEmitter` half of [`FakeDeps`]: records every daemon event and
//! every background-task / workflow-run teardown call.

use std::sync::Mutex;

use mainframe_types::background_task::BackgroundTask;
use mainframe_types::events::DaemonEvent;

use super::FakeDeps;
use crate::chat_manager::EventEmitter;

#[derive(Default)]
pub(crate) struct FakeEventEmitter {
    pub(crate) events: Mutex<Vec<DaemonEvent>>,
    /// What `tracker_list_live` answers.
    pub(crate) live_tasks: Mutex<Vec<BackgroundTask>>,
    /// Every chat id `tracker_end_all_running` was called with, in order.
    pub(crate) tracker_ended: Mutex<Vec<String>>,
    /// Every chat id `tracker_remove_chat` was called with, in order.
    pub(crate) tracker_removed: Mutex<Vec<String>>,
    /// Every chat id `workflow_runs_stop_all` was called with, in order.
    pub(crate) workflow_runs_stopped: Mutex<Vec<String>>,
}

impl FakeEventEmitter {
    pub(crate) fn events(&self) -> Vec<DaemonEvent> {
        self.events.lock().unwrap().clone()
    }
}

impl EventEmitter for FakeDeps {
    fn emit_event(&self, event: DaemonEvent) {
        self.emitter.events.lock().unwrap().push(event);
    }
    fn tracker_remove_chat(&self, chat_id: &str) {
        self.emitter
            .tracker_removed
            .lock()
            .unwrap()
            .push(chat_id.to_string());
    }
    fn tracker_list_live(&self, _chat_id: &str) -> Vec<BackgroundTask> {
        self.emitter.live_tasks.lock().unwrap().clone()
    }
    fn tracker_end_all_running(&self, chat_id: &str) {
        self.emitter
            .tracker_ended
            .lock()
            .unwrap()
            .push(chat_id.to_string());
    }
    fn workflow_runs_stop_all(&self, chat_id: &str) {
        self.emitter
            .workflow_runs_stopped
            .lock()
            .unwrap()
            .push(chat_id.to_string());
    }
}
