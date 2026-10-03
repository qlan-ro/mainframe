use std::sync::Arc;

use mainframe_adapter_api::SessionSink;
use mainframe_types::adapter::{MessageMetadata, SessionResult};
use mainframe_types::chat::{MessageContent, TodoItem};

use mainframe_types::transcript_presentation::{PresentationUpdate, TranscriptPresentation};

pub(crate) struct PresentationSink {
    inner: Arc<dyn SessionSink>,
    presentation: TranscriptPresentation,
}
impl PresentationSink {
    pub(crate) fn wrap(
        inner: Arc<dyn SessionSink>,
        presentation: TranscriptPresentation,
    ) -> Arc<dyn SessionSink> {
        Arc::new(Self {
            inner,
            presentation,
        })
    }
}

impl SessionSink for PresentationSink {
    fn on_init(&self, session_id: &str) {
        self.inner.on_init(session_id);
    }
    fn on_message(&self, content: Vec<MessageContent>, metadata: Option<MessageMetadata>) {
        self.inner
            .on_message_with_presentation(content, metadata, self.presentation.clone());
    }
    fn on_tool_result(&self, content: Vec<MessageContent>, vendor_id: Option<String>) {
        self.inner.on_tool_result(content, vendor_id);
    }
    fn on_message_partial(&self, id: &str, content: Vec<MessageContent>) {
        self.inner
            .on_message_partial_with_presentation(id, content, self.presentation.clone());
    }
    fn on_presentation_update(&self, update: PresentationUpdate) {
        self.inner.on_presentation_update(update);
    }
    fn on_permission(&self, request: mainframe_adapter_api::ControlRequest) {
        self.inner.on_permission(request);
    }
    fn on_permission_cancelled(&self, request_id: &str) {
        self.inner.on_permission_cancelled(request_id);
    }
    fn on_result(&self, data: SessionResult) {
        self.inner.on_result(data);
    }
    fn on_exit(&self, code: Option<i32>) {
        self.inner.on_exit(code);
    }
    fn on_error(&self, error: mainframe_adapter_api::AdapterError) {
        self.inner.on_error(error);
    }
    fn on_compact(&self, vendor_id: Option<&str>) {
        self.inner.on_compact(vendor_id);
    }
    fn on_compact_start(&self) {
        self.inner.on_compact_start();
    }
    fn on_context_usage(&self, usage: mainframe_types::adapter::ContextUsage) {
        self.inner.on_context_usage(usage);
    }
    fn on_plan_file(&self, file_path: &str) {
        self.inner.on_plan_file(file_path);
    }
    fn on_skill_file(&self, entry: mainframe_types::context::SkillFileEntry) {
        self.inner.on_skill_file(entry);
    }
    fn on_queued_processed(&self, uuid: &str) {
        self.inner.on_queued_processed(uuid);
    }
    fn on_todo_update(&self, todos: Vec<TodoItem>) {
        self.inner.on_todo_update(todos);
    }
    fn on_pr_detected(&self, pr: mainframe_types::adapter::DetectedPr) {
        self.inner.on_pr_detected(pr);
    }
    fn on_cli_message(&self, text: &str) {
        self.inner.on_cli_message(text);
    }
    fn on_skill_loaded(&self, entry: mainframe_adapter_api::LoadedSkill) {
        self.inner.on_skill_loaded(entry);
    }
    fn on_subagent_child(&self, parent_tool_use_id: &str, blocks: Vec<MessageContent>) {
        self.inner.on_subagent_child(parent_tool_use_id, blocks);
    }
    fn on_trust_required(&self, project_path: &str) {
        self.inner.on_trust_required(project_path);
    }
}
