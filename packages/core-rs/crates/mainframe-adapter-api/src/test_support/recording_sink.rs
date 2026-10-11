use crate::SessionSink;
use mainframe_types::adapter::DetectedPr;
use mainframe_types::sync::LockExt;
use std::sync::Mutex;

#[derive(Default)]
pub struct RecordingSink {
    pub prs: Mutex<Vec<DetectedPr>>,
    pub cancelled: Mutex<Vec<String>>,
    changed: tokio::sync::Notify,
}

impl RecordingSink {
    pub fn prs(&self) -> Vec<DetectedPr> {
        self.prs.lock_recover().clone()
    }

    pub async fn wait_for_pr(&self) {
        loop {
            let changed = self.changed.notified();
            tokio::pin!(changed);
            changed.as_mut().enable();
            if !self.prs.lock_recover().is_empty() {
                return;
            }
            changed.await;
        }
    }
}

impl SessionSink for RecordingSink {
    crate::forward_session_sink!(
        on_init,
        on_message,
        on_tool_result,
        on_permission,
        on_result,
        on_exit,
        on_error,
        on_compact,
        on_compact_start,
        on_context_usage,
        on_plan_file,
        on_skill_file,
        on_queued_processed,
        on_todo_update,
        on_cli_message,
        on_skill_loaded,
        on_subagent_child
    );
    fn on_pr_detected(&self, pr: DetectedPr) {
        self.prs.lock_recover().push(pr);
        self.changed.notify_waiters();
    }
    fn on_permission_cancelled(&self, request_id: &str) {
        self.cancelled.lock_recover().push(request_id.to_string());
    }
}
