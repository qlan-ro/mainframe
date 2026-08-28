//! `ParentIdSink` must forward every `SessionSink` callback, including new ones
//! added after it was written (#284) — a silent drop here is a trap.

use std::sync::{Arc, Mutex};

use mainframe_adapter_api::SessionSink;
use mainframe_types::adapter::DetectedPr;
use mainframe_types::chat::{MessageContent, TodoItem};
use mainframe_types::context::SkillFileEntry;

use super::ParentIdSink;

#[derive(Default)]
struct RecordingSink {
    cancelled: Mutex<Vec<String>>,
}
impl SessionSink for RecordingSink {
    fn on_init(&self, _session_id: &str) {}
    fn on_message(
        &self,
        _content: Vec<MessageContent>,
        _metadata: Option<mainframe_types::adapter::MessageMetadata>,
    ) {
    }
    fn on_tool_result(&self, _content: Vec<MessageContent>, _vendor_id: Option<String>) {}
    fn on_permission(&self, _request: mainframe_adapter_api::ControlRequest) {}
    fn on_permission_cancelled(&self, request_id: &str) {
        self.cancelled
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .push(request_id.to_string());
    }
    fn on_result(&self, _data: mainframe_types::adapter::SessionResult) {}
    fn on_exit(&self, _code: Option<i32>) {}
    fn on_error(&self, _error: mainframe_adapter_api::AdapterError) {}
    fn on_compact(&self) {}
    fn on_compact_start(&self) {}
    fn on_context_usage(&self, _usage: mainframe_types::adapter::ContextUsage) {}
    fn on_plan_file(&self, _file_path: &str) {}
    fn on_skill_file(&self, _entry: SkillFileEntry) {}
    fn on_queued_processed(&self, _uuid: &str) {}
    fn on_todo_update(&self, _todos: Vec<TodoItem>) {}
    fn on_pr_detected(&self, _pr: DetectedPr) {}
    fn on_cli_message(&self, _text: &str) {}
    fn on_skill_loaded(&self, _entry: mainframe_adapter_api::LoadedSkill) {}
    fn on_subagent_child(&self, _parent_tool_use_id: &str, _blocks: Vec<MessageContent>) {}
}

#[test]
fn parent_id_sink_forwards_a_permission_cancellation() {
    let inner = Arc::new(RecordingSink::default());
    let wrapper = ParentIdSink::new(inner.clone(), "parent-1".to_string());

    wrapper.on_permission_cancelled("req_1");

    assert_eq!(
        *inner.cancelled.lock().unwrap_or_else(|e| e.into_inner()),
        vec!["req_1".to_string()]
    );
}
