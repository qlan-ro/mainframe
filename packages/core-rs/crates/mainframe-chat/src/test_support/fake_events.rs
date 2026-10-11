//! The `EventEmitter` half of [`FakeDeps`]: records every daemon event and
//! every background-task / workflow-run teardown call.

use mainframe_types::sync::LockExt as _;
use std::sync::Mutex;

use std::sync::Arc;

use mainframe_background_tasks::tracker::BackgroundTaskTracker;
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
    /// When set, `tracker_end_all_running` also ends the tasks in it.
    pub(crate) tracker: Mutex<Option<Arc<BackgroundTaskTracker>>>,
}

impl FakeEventEmitter {
    pub(crate) fn events(&self) -> Vec<DaemonEvent> {
        self.events.lock_recover().clone()
    }
}

impl EventEmitter for FakeDeps {
    fn emit_event(&self, event: DaemonEvent) {
        self.emitter.events.lock_recover().push(event);
    }
    fn tracker_remove_chat(&self, chat_id: &str) {
        self.emitter
            .tracker_removed
            .lock_recover()
            .push(chat_id.to_string());
    }
    fn tracker_list_live(&self, _chat_id: &str) -> Vec<BackgroundTask> {
        self.emitter.live_tasks.lock_recover().clone()
    }
    fn tracker_end_all_running(&self, chat_id: &str) {
        self.emitter
            .tracker_ended
            .lock_recover()
            .push(chat_id.to_string());
        if let Some(tracker) = self.emitter.tracker.lock_recover().as_ref() {
            tracker.end_all_running(chat_id);
        }
    }
    fn workflow_runs_stop_all(&self, chat_id: &str) {
        self.emitter
            .workflow_runs_stopped
            .lock_recover()
            .push(chat_id.to_string());
    }
}
