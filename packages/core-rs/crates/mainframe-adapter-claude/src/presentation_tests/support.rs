use crate::{events, session};
use mainframe_adapter_api::SessionSink;
use mainframe_types::transcript_presentation::{PresentationUpdate, TranscriptPresentation};
use mainframe_types::{
    adapter::{MessageMetadata, SessionOptions},
    chat::MessageContent,
};
use serde_json::{Value, json};
use std::sync::{Arc, Mutex};
#[derive(Default)]
pub(super) struct RecordingSink {
    pub(super) messages: Mutex<Vec<(Vec<MessageContent>, String, TranscriptPresentation)>>,
    pub(super) updates: Mutex<Vec<PresentationUpdate>>,
}
impl SessionSink for RecordingSink {
    mainframe_adapter_api::forward_session_sink!(
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
        on_pr_detected,
        on_cli_message,
        on_skill_loaded,
        on_subagent_child
    );

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
