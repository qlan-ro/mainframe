use crate::SessionSink;

#[derive(Default)]
pub struct NullSink;

impl SessionSink for NullSink {
    fn on_init(&self, _session_id: &str) {}
    fn on_message(
        &self,
        _content: Vec<mainframe_types::chat::MessageContent>,
        _metadata: Option<mainframe_types::adapter::MessageMetadata>,
    ) {
    }
    fn on_tool_result(
        &self,
        _content: Vec<mainframe_types::chat::MessageContent>,
        _vendor_id: Option<String>,
    ) {
    }
    fn on_permission(&self, _request: crate::ControlRequest) {}
    fn on_result(&self, _data: mainframe_types::adapter::SessionResult) {}
    fn on_exit(&self, _code: Option<i32>) {}
    fn on_error(&self, _error: crate::AdapterError) {}
    fn on_compact(&self, _vendor_id: Option<&str>) {}
    fn on_compact_start(&self) {}
    fn on_context_usage(&self, _usage: mainframe_types::adapter::ContextUsage) {}
    fn on_plan_file(&self, _file_path: &str) {}
    fn on_skill_file(&self, _entry: mainframe_types::context::SkillFileEntry) {}
    fn on_queued_processed(&self, _uuid: &str) {}
    fn on_todo_update(&self, _todos: Vec<mainframe_types::chat::TodoItem>) {}
    fn on_pr_detected(&self, _pr: mainframe_types::adapter::DetectedPr) {}
    fn on_cli_message(&self, _text: &str) {}
    fn on_skill_loaded(&self, _entry: crate::LoadedSkill) {}
    fn on_subagent_child(
        &self,
        _parent_tool_use_id: &str,
        _blocks: Vec<mainframe_types::chat::MessageContent>,
    ) {
    }
}
