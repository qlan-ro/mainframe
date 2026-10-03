use crate::{events, session};
use mainframe_adapter_api::{AdapterError, SessionSink};
use mainframe_types::transcript_presentation::{PresentationUpdate, TranscriptPresentation};
use mainframe_types::{
    adapter::{MessageMetadata, SessionOptions},
    chat::MessageContent,
    context::SkillFileEntry,
};
use serde_json::{Value, json};
use std::sync::{Arc, Mutex};
#[derive(Default)]
pub(super) struct RecordingSink {
    pub(super) messages: Mutex<Vec<(Vec<MessageContent>, String, TranscriptPresentation)>>,
    pub(super) updates: Mutex<Vec<PresentationUpdate>>,
}
impl SessionSink for RecordingSink {
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
    fn on_permission(&self, _request: mainframe_types::adapter::ControlRequest) {}
    fn on_result(&self, _data: mainframe_types::adapter::SessionResult) {}
    fn on_exit(&self, _code: Option<i32>) {}
    fn on_error(&self, _error: AdapterError) {}
    fn on_compact(&self, _vendor_id: Option<&str>) {}
    fn on_compact_start(&self) {}
    fn on_context_usage(&self, _usage: mainframe_types::adapter::ContextUsage) {}
    fn on_plan_file(&self, _file_path: &str) {}
    fn on_skill_file(&self, _entry: SkillFileEntry) {}
    fn on_queued_processed(&self, _uuid: &str) {}
    fn on_todo_update(&self, _todos: Vec<mainframe_types::chat::TodoItem>) {}
    fn on_pr_detected(&self, _pr: mainframe_types::adapter::DetectedPr) {}
    fn on_cli_message(&self, _text: &str) {}
    fn on_skill_loaded(&self, _entry: mainframe_adapter_api::LoadedSkill) {}
    fn on_subagent_child(
        &self,
        _parent_tool_use_id: &str,
        _blocks: Vec<mainframe_types::chat::MessageContent>,
    ) {
    }
    fn on_message_with_presentation(
        &self,
        content: Vec<MessageContent>,
        metadata: Option<MessageMetadata>,
        context: TranscriptPresentation,
    ) {
        self.messages.lock().unwrap().push((
            content,
            metadata.unwrap().vendor_id.unwrap(),
            context,
        ));
    }
    fn on_presentation_update(&self, update: PresentationUpdate) {
        self.updates.lock().unwrap().push(update);
    }
}

pub(super) fn session() -> session::ClaudeSession {
    session::ClaudeSession::new(
        SessionOptions {
            project_path: "/tmp".into(),
            chat_id: None,
            mainframe_chat_id: "chat".into(),
            session_file_path: None,
            fork_source: None,
        },
        None,
        Arc::new(mainframe_background_tasks::tracker::BackgroundTaskTracker::new()),
        Arc::new(mainframe_claude_workflows::store::ClaudeWorkflowStore::new()),
        mainframe_runtime::ResolvedPath::from_value("/usr/bin:/bin"),
    )
}
pub(super) fn feed(session: &session::ClaudeSession, sink: &RecordingSink, event: Value) {
    events::handle_stdout(session, format!("{event}\n").as_bytes(), sink);
}
pub(super) fn assistant(id: &str, uuid: &str, stop: Value) -> Value {
    json!({"type":"assistant","session_id":"provider-session","uuid":uuid,"message":{"id":id,"stop_reason":stop,"content":[{"type":"text","text":uuid}]}})
}
pub(super) fn result() -> Value {
    json!({"type":"result","session_id":"provider-session","subtype":"success","is_error":false,"duration_ms":123})
}
